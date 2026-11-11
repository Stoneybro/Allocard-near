// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { EmployeeDashboardState } from "@/app/actions/identity";
import { ADAPTER_NAME, RESEARCH_AGENT_NAME, WORKER_HANDLE, type ResearchTask } from "@/lib/agent-adapter/shared";
vi.mock("@/hooks/use-account-queries", () => ({ useAccountScope: () => ({ key: ["test"] }) }));
import { EmployeeAgentsWorkspace } from "@/components/employee-agents-workspace";

const permission: EmployeeDashboardState["outboundDelegations"][number] = {
  id: "permission", parentDelegationId: "parent", delegatorType: "user", delegatorId: "employee", delegateeType: "agent", delegateeId: "agent", delegationHash: "2", signedDelegation: {}, policyPrompt: null, status: "active", canvasPositionX: 0, canvasPositionY: 0, caveats: [], createdAt: "2026-11-10T12:00:00Z", activatedAt: null, revokedAt: null, remainingNear: "8",
};
const agent = { id: "agent", name: ADAPTER_NAME, description: null, smartAccountAddress: "agent.testnet", signerAddress: "agent.testnet", isActive: true, createdAt: permission.createdAt };
const task: ResearchTask = { id: "task", companyId: "company", delegationId: permission.id, employeeId: "employee", prompt: "Compare software for our team", digest: "a".repeat(64), state: "delivered", result: "Research report: three suitable products", message: "Complete", createdAt: permission.createdAt, expiresAt: "2099-11-10T12:00:00Z" };
let host: HTMLDivElement, root: ReturnType<typeof createRoot>, client: QueryClient;
const configure = vi.fn(), select = vi.fn(), revoke = vi.fn();
const click = async (label: string, scope: ParentNode = document) => act(async () => {
  const button = [...scope.querySelectorAll<HTMLButtonElement>("button")].find(item => item.textContent === label);
  expect(button, `button ${label}`).toBeTruthy(); button!.click();
});
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function render(rows: typeof permission[] = []) {
  await act(async () => root.render(<QueryClientProvider client={client}><EmployeeAgentsWorkspace companyId="company" agents={[agent]} delegations={rows} canAdd onSelectAgent={select} onConfigure={configure} onRevoke={revoke} /></QueryClientProvider>));
  await flush();
}
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); host.remove(); vi.unstubAllGlobals(); });

it("sets up the known research agent, resumes unfinished setup, and treats revoked access as unset", async () => {
  await render(); await click("Set up agent", host); expect(select).toHaveBeenCalledWith("agent");
  await render([{ ...permission, status: "pending_config" }]);
  await click("Set up agent", host); expect(configure).toHaveBeenCalledWith("permission");
  await render([{ ...permission, status: "revoked" }]);
  expect(host.textContent).not.toContain("Add agent"); expect(host.textContent).not.toContain("View rules");
  await click("Set up agent", host); expect(select).toHaveBeenCalledTimes(2);
});

it("keeps access controls available and requires explicit confirmation to revoke", async () => {
  await render([permission]);
  expect(host.textContent).toContain("Add agent");
  await click("View rules", host); expect(configure).toHaveBeenCalledWith("permission");
  await click("Revoke access", host); expect(revoke).not.toHaveBeenCalled();
  await click("Revoke access", document.querySelector('[role="alertdialog"]')!);
  expect(revoke).toHaveBeenCalledWith("permission");
});

it("lists each confirmed task separately, hides proposals, and opens the selected result", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([task, { ...task, id: "second", prompt: "Compare help desk tools", result: "Help desk report" }, { ...task, id: "draft", state: "proposal" }])));
  await render([permission]);
  expect(host.querySelectorAll("tbody tr")).toHaveLength(2);
  expect(host.textContent).toContain("Completed");
  await click("View", host);
  const dialog = document.querySelector('[role="dialog"]');
  expect(dialog?.textContent).toContain(task.result); expect(dialog?.textContent).not.toContain("Help desk report");
  expect(host.textContent).not.toContain("Adapter");
});

it("previews live marketplace agents, disables other hires, and dispatches only after final confirmation", async () => {
  const actions: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      const body = JSON.parse(options.body as string); actions.push(body.action);
      return Response.json({ ...task, state: body.action === "prepare" ? "proposal" : "delivered" });
    }
    if (url.includes("&q=")) return Response.json({ agents: [
      { id: "market-research", name: RESEARCH_AGENT_NAME, handle: WORKER_HANDLE, description: "Compare products", price: null, url: "https://market.near.ai" },
      { id: "other", name: "Other agent", handle: "other", description: "Other services", price: "10", url: "https://market.near.ai" },
    ] });
    return Response.json([]);
  }));
  await render([permission]); await click("Add agent", host);
  expect(document.querySelector<HTMLTextAreaElement>("textarea")?.value).toContain("project management");
  await click("Find agents"); await flush();
  const dialog = document.querySelector('[role="dialog"]')!;
  expect(dialog.textContent).toContain("NEAR AI Market");
  expect(dialog.querySelector<HTMLButtonElement>('button[aria-label="Hire Other agent"]')?.disabled).toBe(true);
  expect(actions).toEqual([]);
  await click("Hire", dialog); await flush();
  expect(actions).toEqual(["prepare"]); expect(dialog.textContent).toContain("Review your task");
  await click("Confirm and start", dialog); await flush();
  expect(actions).toEqual(["prepare", "confirm"]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("retries preparation with the same request identity and retries confirmation against the same proposal", async () => {
  const preparations: { requestId: string }[] = [], confirmations: { id: string; digest: string }[] = [];
  vi.stubGlobal("fetch", vi.fn(async (url: string, options?: RequestInit) => {
    if (options?.method === "POST") {
      const body = JSON.parse(options.body as string);
      if (body.action === "prepare") {
        preparations.push(body.task);
        if (preparations.length === 1) throw new TypeError("Connection lost");
        return Response.json({ ...task, state: "proposal" });
      }
      confirmations.push(body.task);
      if (confirmations.length === 1) throw new TypeError("Response lost after dispatch");
      return Response.json(task);
    }
    if (url.includes("&q=")) return Response.json({ agents: [{ id: "research", name: RESEARCH_AGENT_NAME, handle: WORKER_HANDLE, description: "Research", price: null, url: "https://market.near.ai" }] });
    return Response.json([]);
  }));
  await render([permission]); await click("Add agent", host); await click("Find agents"); await flush();
  await click("Hire"); await flush();
  expect(document.querySelector('[role="alert"]')?.textContent).toContain("Retry");
  await click("Hire"); await flush();
  expect(preparations[0].requestId).toBe(preparations[1].requestId);
  await click("Confirm and start"); await flush();
  expect(document.querySelector('[role="dialog"]')).toBeTruthy();
  await click("Confirm and start"); await flush();
  expect(confirmations).toEqual([{ id: task.id, digest: task.digest }, { id: task.id, digest: task.digest }]);
  expect(document.querySelector('[role="dialog"]')).toBeNull();
});

it("advances a running task and displays its returned report without a new hire", async () => {
  const actions: string[] = [];
  vi.stubGlobal("fetch", vi.fn(async (_url: string, options?: RequestInit) => {
    if (options?.method === "POST") { actions.push(JSON.parse(options.body as string).action); return Response.json(task); }
    return Response.json([{ ...task, state: "running", result: null }]);
  }));
  await render([permission]); await flush();
  expect(host.textContent).toContain("Completed");
  expect(actions.every(action => action === "progress")).toBe(true);
  await click("View", host);
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain(task.result);
});
