// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ auth: {} as Record<string, unknown>, profile: vi.fn(), push: vi.fn(), connect: vi.fn(), prefetch: vi.fn() }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => mocks.auth }));
vi.mock("next/navigation", () => ({ useRouter: () => router }));
vi.mock("next/image", () => ({ default: (props: Record<string, unknown>) => <span aria-label={String(props.alt)} /> }));
vi.mock("@/app/actions/identity", () => ({ getWalletProfile: mocks.profile }));
import { LandingPageClient } from "@/app/LandingPageClient";
const router = { push: mocks.push, prefetch: mocks.prefetch };
let root: Root; let host: HTMLDivElement; let client: QueryClient;
async function render() { await act(async () => { root.render(<QueryClientProvider client={client}><LandingPageClient /></QueryClientProvider>); }); }
async function reloadLanding() {
  await act(async () => root.unmount());
  client.clear();
  client = new QueryClient();
  root = createRoot(host);
  await render();
}
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  sessionStorage.clear();
  mocks.auth = { status: "unauthenticated", connect: mocks.connect };
  mocks.profile.mockResolvedValue({ status: "employer" });
  host = document.createElement("div"); root = createRoot(host); client = new QueryClient();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); });
describe("landing sign-in routing", () => {
  it("keeps both entry buttons busy between provider sign-in and dashboard navigation", async () => {
    let finish!: (profile: { status: string }) => void;
    mocks.profile.mockImplementationOnce(() => new Promise(resolve => { finish = resolve; }));
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    mocks.auth = { status: "connecting" }; await render();
    expect(host.querySelector<HTMLButtonElement>("#nav-cta")!.disabled).toBe(true);
    expect(host.textContent).toContain("Signing in…");
    mocks.auth = { status: "authenticated", address: "a".repeat(64), providerUserId: "did:privy:alice" }; await render();
    expect(host.textContent).toContain("Opening dashboard…");
    expect(host.querySelector<HTMLButtonElement>("#nav-cta")!.disabled).toBe(true);
    await act(async () => finish({ status: "employer" }));
    expect(mocks.push).toHaveBeenCalledWith("/employer");
  });
  it.each([
    ["employer", "/employer"],
    ["employee", "/employee"],
    ["new", "/onboarding"],
  ])("resumes %s sign-in after a reload without redirecting a later landing visit", async (status, destination) => {
    mocks.profile.mockResolvedValue({ status });
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    mocks.auth = { status: "connecting" };
    await reloadLanding();
    expect(mocks.push).not.toHaveBeenCalled();
    mocks.auth = { status: "authenticated", address: "a".repeat(64), providerUserId: "did:privy:alice" };
    await render();
    expect(mocks.push).toHaveBeenCalledTimes(1);
    expect(mocks.push).toHaveBeenCalledWith(destination);
    mocks.push.mockClear();
    await reloadLanding();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(host.textContent).toContain("Go to Dashboard");
  });
  it.each(["expired", "invalid", "future"])("ignores %s pending sign-in on a later visit", async (kind) => {
    const value = kind === "expired" ? Date.now() - 11 * 60_000 : kind === "future" ? Date.now() + 60_000 : "true";
    sessionStorage.setItem("allocard_pending_login_at", String(value));
    mocks.auth = { status: "authenticated", address: "a".repeat(64), providerUserId: "did:privy:alice" };
    await render();
    expect(mocks.push).not.toHaveBeenCalled();
    expect(sessionStorage.getItem("allocard_pending_login_at")).toBeNull();
  });
  it("lets the user retry a failed workspace lookup without leaving a pending redirect", async () => {
    mocks.profile.mockRejectedValueOnce(new Error("Workspace unavailable"));
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    mocks.auth = { status: "authenticated", address: "a".repeat(64), providerUserId: "did:privy:alice" };
    await reloadLanding();
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("Workspace unavailable");
    expect(sessionStorage.getItem("allocard_pending_login_at")).toBeNull();
    await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    expect(mocks.push).toHaveBeenCalledWith("/employer");
  });
  it("opens Privy directly and routes only after authentication", async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    expect(mocks.connect).toHaveBeenCalledTimes(1); expect(mocks.push).not.toHaveBeenCalled();
    mocks.auth = { status: "authenticated", address: "a".repeat(64), providerUserId: "did:privy:alice" };
    await render();
    expect(mocks.push).toHaveBeenCalledWith("/employer");
  });
  it("queues a click during SDK initialization without disabling entry", async () => {
    mocks.auth = { status: "connecting" };
    await render();
    expect(host.querySelector<HTMLButtonElement>("#nav-cta")!.disabled).toBe(false);
    await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    mocks.auth = { status: "unauthenticated", connect: mocks.connect };
    await render();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    await render();
    expect(mocks.connect).toHaveBeenCalledTimes(1);
    mocks.auth = { status: "authenticated", address: "a".repeat(64), providerUserId: "did:privy:alice" };
    await render();
    expect(mocks.push).toHaveBeenCalledWith("/employer");
  });
  it("reuses a fresh account-scoped profile for navigation", async () => {
    const address = "a".repeat(64);
    client.setQueryData(["allocard", "testnet", "did:privy:alice", address, "profile"], { status: "employee" });
    mocks.auth = { status: "authenticated", address, providerUserId: "did:privy:alice" };
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    expect(mocks.push).toHaveBeenCalledWith("/employee");
    expect(mocks.profile).not.toHaveBeenCalled();
  });
  it("routes a new user to company onboarding after signing in", async () => {
    mocks.profile.mockResolvedValue({ status: "new" });
    await render(); await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    mocks.auth = { status: "authenticated", address: "a".repeat(64), providerUserId: "did:privy:alice" };
    await render();
    expect(mocks.push).toHaveBeenCalledWith("/onboarding");
  });
  it("keeps the entry button usable when the modal is dismissed", async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    expect(mocks.connect).toHaveBeenCalledTimes(2); expect(mocks.push).not.toHaveBeenCalled();
  });
});
