// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, options: vi.fn(), push: vi.fn(), replace: vi.fn() }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: mocks.push, replace: mocks.replace }) }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => <span aria-label={String(props.alt)} /> }));
vi.mock("@/app/actions/identity", () => ({ getWorkspaceOptions: mocks.options, getWalletProfile: vi.fn(), acceptEmployeeMembership: vi.fn(), createEmployerAccount: vi.fn(), setWorkspaceContext: vi.fn() }));
import OnboardingPage from "@/app/onboarding/page";
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
