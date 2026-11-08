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
beforeEach(() => {
  vi.clearAllMocks(); Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  mocks.auth = { status: "unauthenticated", connect: mocks.connect };
  mocks.profile.mockResolvedValue({ status: "employer" });
  host = document.createElement("div"); root = createRoot(host); client = new QueryClient();
});
afterEach(async () => { await act(async () => root.unmount()); client.clear(); });
describe("landing sign-in routing", () => {
  it("opens Privy directly and routes only after authentication", async () => {
    await render();
    await act(async () => host.querySelector<HTMLButtonElement>("#nav-cta")!.click());
    expect(mocks.connect).toHaveBeenCalledTimes(1); expect(mocks.push).not.toHaveBeenCalled();
    mocks.auth = { status: "authenticated", address: "a".repeat(64), providerUserId: "did:privy:alice" };
    await render();
    expect(mocks.push).toHaveBeenCalledWith("/employer");
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
