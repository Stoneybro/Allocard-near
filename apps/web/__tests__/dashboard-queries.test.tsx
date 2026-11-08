// @vitest-environment jsdom
import { act, useEffect } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, profile: vi.fn(), load: vi.fn(), replace: vi.fn() }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace: mocks.replace }) }));
vi.mock("@/app/actions/identity", () => ({ getWalletProfile: mocks.profile, getWorkspaceOptions: vi.fn() }));
import { useDashboardData } from "@/hooks/use-account-queries";
type Snapshot = { company: { id: string }; employees: string[]; remaining: string };
let root: Root; let host: HTMLDivElement; let client: QueryClient;
let dashboard: ReturnType<typeof useDashboardData<Snapshot>>;
let role: "employer" | "employee";
function Probe() {
  const current = useDashboardData<Snapshot>(role, mocks.load);
  useEffect(() => { dashboard = current; }, [current]);
  return <span>{current.error?.message ?? current.dashboardState?.remaining ?? "loading"}</span>;
}
async function render() { await act(async () => { root.render(<QueryClientProvider client={client}><Probe /></QueryClientProvider>); }); }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 15)); }); }
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.auth = { status: "authenticated", address: "a".repeat(64), providerUserId: "did:privy:alice" };
  role = "employer";
  mocks.profile.mockImplementation(async () => ({ status: role, user: { walletAddress: mocks.auth.address, companyId: "company" }, company: { id: "company" } }));
  mocks.load.mockResolvedValue({ company: { id: "company" }, employees: ["one"], remaining: "10" });
  host = document.createElement("div"); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 }, mutations: { retry: false } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); });
describe.each(["employer", "employee"] as const)("%s dashboard cache", dashboardRole => {
  it("deduplicates reads and refreshes related data after a mutation", async () => {
    role = dashboardRole; await render(); await flush(); await flush();
    expect(host.textContent).toBe("10");
    await render(); await flush(); expect(mocks.load).toHaveBeenCalledTimes(1);
    const next = { company: { id: "company" }, employees: ["one", "two"], remaining: "8" };
    mocks.load.mockResolvedValue(next);
    await act(async () => { await dashboard.mutate(async () => next); }); await flush();
    expect(host.textContent).toBe("8"); expect(dashboard.dashboardState?.employees).toHaveLength(2);
    expect(mocks.load).toHaveBeenCalledTimes(2);
  });
  it("never retries a failed mutation automatically", async () => {
    role = dashboardRole; await render(); await flush(); await flush();
    const write = vi.fn().mockRejectedValue(new Error("Transaction uncertain"));
    await act(async () => { await expect(dashboard.mutate(write)).rejects.toThrow("Transaction uncertain"); });
    expect(write).toHaveBeenCalledTimes(1); expect(host.textContent).toBe("10");
  });
  it("does not display an old dashboard for another identity", async () => {
    role = dashboardRole; await render(); await flush(); await flush();
    expect(host.textContent).toBe("10");
    mocks.auth = { status: "authenticated", address: "b".repeat(64), providerUserId: "did:privy:bob" };
    mocks.profile.mockImplementationOnce(() => new Promise(() => {})); await render();
    expect(host.textContent).toBe("loading");
  });
});
