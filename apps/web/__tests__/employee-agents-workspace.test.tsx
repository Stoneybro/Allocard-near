// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import type { EmployeeDashboardState } from "@/app/actions/identity";
vi.mock("@/hooks/use-account-queries", () => ({ useAccountScope: () => ({ key: ["test"] }) }));
import { EmployeeAgentsWorkspace } from "@/components/employee-agents-workspace";
const row: EmployeeDashboardState["outboundDelegations"][number] = {
  id: "permission", parentDelegationId: "parent", delegatorType: "user", delegatorId: "employee", delegateeType: "agent", delegateeId: "agent", delegationHash: "2", signedDelegation: {}, policyPrompt: null, status: "active", canvasPositionX: 0, canvasPositionY: 0, caveats: [], createdAt: "2026-11-10T12:00:00Z", activatedAt: null, revokedAt: null, remainingNear: "8",
};
it("shows active agents, hides revoked rows, and requires confirmation before revocation", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host), configure = vi.fn(), revoke = vi.fn();
  try {
    await act(async () => root.render(<EmployeeAgentsWorkspace companyId="company" agents={[{ id: "agent", name: "Travel agent", description: null, smartAccountAddress: "agent.testnet", signerAddress: "agent.testnet", isActive: true, createdAt: row.createdAt }]} delegations={[row, { ...row, id: "revoked", status: "revoked" }]} canAdd onSelectAgent={vi.fn()} onConfigure={configure} onRevoke={revoke} />));
    expect(host.querySelectorAll("tbody tr")).toHaveLength(1);
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "View rules")!.click());
    expect(configure).toHaveBeenCalledWith("permission");
    await act(async () => [...host.querySelectorAll<HTMLButtonElement>("button")].find(button => button.textContent === "Revoke")!.click());
    expect(revoke).not.toHaveBeenCalled();
    await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Revoke agent")!.click());
    expect(revoke).toHaveBeenCalledWith("permission");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
