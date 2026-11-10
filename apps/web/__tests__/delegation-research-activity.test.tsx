// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
vi.mock("@/hooks/use-account-queries", () => ({ useAccountScope: () => ({ key: ["test", "owner"] }) }));
import { DelegationCardsView } from "@/components/delegation-cards-view";
import { ADAPTER_NAME } from "@/lib/agent-adapter/shared";

it("opens activity for the exact employee agent delegation without granting management controls", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const fetchMock = vi.fn(async () => Response.json([{ id: "run", prompt: "Compare support tools", state: "delivered", createdAt: "2026-11-10T12:00:00Z", result: "Research report contents", message: "Complete" }]));
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  document.body.append(host);
  const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><DelegationCardsView
      company={{ id: "company", name: "Acme", smartAccountAddress: null }}
      employees={[{ id: "employee", label: "Alex", smartAccountAddress: null }]}
      agents={[{ id: "adapter", name: ADAPTER_NAME, smartAccountAddress: null }]}
      delegations={[{ id: "permission", delegateeType: "agent", delegateeId: "adapter", delegatorType: "user", delegatorId: "employee", parentDelegationId: null, status: "active", canvasPositionX: 0, canvasPositionY: 0 }]}
      viewMode="cards" onViewModeChange={() => {}} onConfigureDelegation={vi.fn()} onRevokeDelegation={vi.fn()}
    /></QueryClientProvider>));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(host.querySelector('button[aria-label^="Revoke delegation"]')).toBeNull();
    expect(host.querySelector('button[aria-label^="View rules for"]')).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label^="View activity for"]')!.click());
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 30)); });
    expect(fetchMock).toHaveBeenCalledWith("/api/agent-adapter?companyId=company&view=company&delegationId=permission", expect.anything());
    const dialog = document.querySelector('[role="dialog"]');
    expect(dialog?.textContent).toContain("Delegated by Alex");
    expect(dialog?.textContent).toContain("Compare support tools");
    expect(dialog?.textContent).toContain("Research report contents");
  } finally {
    await act(async () => root.unmount());
    client.clear(); host.remove(); vi.unstubAllGlobals();
  }
});
