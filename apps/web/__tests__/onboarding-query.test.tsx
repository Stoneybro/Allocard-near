// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, options: vi.fn(), push: vi.fn(), replace: vi.fn(), create: vi.fn(), accept: vi.fn(), select: vi.fn() }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => <span aria-label={String(props.alt)} /> }));
vi.mock("@/app/actions/identity", () => ({ getWorkspaceOptions: mocks.options, getWalletProfile: vi.fn(), acceptEmployeeMembership: mocks.accept, createEmployerAccount: mocks.create, setWorkspaceContext: mocks.select }));
vi.mock("@/lib/dashboard-read", () => ({ dashboardRead: vi.fn().mockResolvedValue({ company: { id: "company" } }) }));
import OnboardingPage from "@/app/onboarding/page";
import { useDashboardData } from "@/hooks/use-account-queries";
function DashboardProbe({ role }: { role: "employer" | "employee" }) {
  const { profile } = useDashboardData(role, { status: "new", user: null, company: null });
  return <span>{profile?.status}</span>;
}
let root: Root; let host: HTMLDivElement; let client: QueryClient;
const identity = { address: "a".repeat(64), providerUserId: "did:privy:alice" };
async function render() { await act(async () => { root.render(<QueryClientProvider client={client}><OnboardingPage /></QueryClientProvider>); }); }
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); }); }
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.auth = { status: "authenticated", ...identity, authMethod: "privy", disconnect: vi.fn(), establishSession: vi.fn() };
  mocks.options.mockResolvedValue({ memberships: [{ companyId: "company", companyName: "Acme", canEmployer: true, canEmployee: false }], pending: [] });
  host = document.createElement("div"); root = createRoot(host);
  client = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: 15_000 } } });
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); vi.useRealTimers(); });
describe("onboarding workspace loading", () => {
  it.each(["create", "join", "employer", "employee"] as const)("publishes the confirmed profile before navigating after %s", async (action) => {
    const role = action === "create" || action === "employer" ? "employer" : "employee";
    const profile = { status: role, user: { walletAddress: identity.address, companyId: "company" }, company: { id: "company", name: "Acme" } };
    const profileKey = ["allocard", "testnet", identity.providerUserId, identity.address, "profile"];
    client.setQueryData(profileKey, { status: "new", user: null, company: null });
    mocks.create.mockResolvedValue(profile); mocks.accept.mockResolvedValue(profile); mocks.select.mockResolvedValue(profile);
    mocks.options.mockResolvedValue({
      memberships: action === "employer" || action === "employee" ? [{ companyId: "company", companyName: "Acme", canEmployer: role === "employer", canEmployee: role === "employee" }] : [],
      pending: action === "join" ? [{ id: "invite", companyId: "company", companyName: "Acme" }] : [],
    });
    mocks.replace.mockImplementation(() => { expect(client.getQueryData(profileKey)).toEqual(profile); });
    await render(); await flush();
    if (action === "create") {
      const input = host.querySelector<HTMLInputElement>("#company-name")!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Acme");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await act(async () => { host.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
    } else {
      const label = action === "join" ? "Accept invitation" : `Open ${action === "employer" ? "company" : "employee"} dashboard`;
      await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent?.includes(label))!.click(); });
    }
    await flush();
    expect(client.getQueryData(profileKey)).toEqual(profile);
    expect(mocks.replace).toHaveBeenCalledWith(`/${role}`);
    expect(mocks.options).toHaveBeenCalledTimes(1);
    expect(host.textContent).not.toContain("Refreshing…");
    if (action === "join") expect(mocks.select).not.toHaveBeenCalled();
    // A prefetched route may still carry the old server profile. The shared
    // cache must win so the dashboard guard cannot bounce back to onboarding.
    await act(async () => { root.render(<QueryClientProvider client={client}><DashboardProbe role={role} /></QueryClientProvider>); });
    expect(host.textContent).toBe(role);
    expect(mocks.replace).not.toHaveBeenCalledWith("/onboarding");
  });
  it("shows refresh progress only for a manual refresh, not background reads", async () => {
    await render(); await flush();
    let finishRead!: (value: unknown) => void;
    mocks.options.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    let background!: Promise<unknown>;
    await act(async () => { background = client.invalidateQueries(); });
    expect(host.textContent).not.toContain("Refreshing…");
    await act(async () => { finishRead({ memberships: [], pending: [] }); await background; });
    await flush();
    mocks.options.mockImplementationOnce(() => new Promise(resolve => { finishRead = resolve; }));
    await act(async () => { [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Refresh access"))!.click(); });
    expect(host.textContent).toContain("Refreshing…");
    await act(async () => { finishRead({ memberships: [], pending: [] }); });
    await flush();
    expect(host.textContent).not.toContain("Refreshing…");
  });
  it("finishes loading even if the session-renewal callback changes on every render", async () => {
    await render(); await flush();
    expect(host.textContent).toContain("Acme");
    for (let i = 0; i < 4; i++) {
      mocks.auth = { ...mocks.auth, establishSession: vi.fn() };
      await render(); await flush();
    }
    expect(mocks.options).toHaveBeenCalledTimes(1);
    expect(mocks.auth.establishSession).not.toHaveBeenCalled();
    expect(host.textContent).not.toContain("Loading your workspaces");
  });
  it("shows an error and allows retry instead of leaving skeletons", async () => {
    mocks.options.mockRejectedValueOnce(new Error("Database unavailable"));
    await render(); await flush();
    expect(host.textContent).toContain("Database unavailable");
    expect(host.textContent).not.toContain("Loading your workspaces");
    const retry = [...host.querySelectorAll("button")].find(button => button.textContent?.includes("Try again"))!;
    await act(async () => retry.click()); await flush();
    expect(host.textContent).toContain("Acme");
  });
  it("ends an indefinitely pending workspace read with a retryable error", async () => {
    vi.useFakeTimers(); mocks.options.mockImplementationOnce(() => new Promise(() => {}));
    await render();
    await act(async () => { await vi.advanceTimersByTimeAsync(30_010); });
    expect(host.textContent).toContain("took too long");
    expect(host.textContent).not.toContain("Loading your workspaces");
  });
  it("does not show a previous account's companies after switching users", async () => {
    await render(); await flush(); expect(host.textContent).toContain("Acme");
    mocks.auth = { ...mocks.auth, address: "b".repeat(64), providerUserId: "did:privy:bob" };
    mocks.options.mockImplementationOnce(() => new Promise(() => {}));
    await render();
    expect(host.textContent).not.toContain("Acme");
  });
});
