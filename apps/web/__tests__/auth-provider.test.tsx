// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQueryClient } from "@tanstack/react-query";
type TestPrivyUser = { id: string; linkedAccounts: { type: string; chainType: string; walletClientType: string; address: string }[] };
const mocks = vi.hoisted(() => ({
  privy: { ready: true, authenticated: false, user: null as TestPrivyUser | null, login: vi.fn(), logout: vi.fn(), getAccessToken: vi.fn() },
  createWallet: vi.fn(), signRawHash: vi.fn(), createPrivySession: vi.fn(), clearSession: vi.fn(),
  baseCall: vi.fn(), baseSend: vi.fn(),
}));
vi.mock("@privy-io/react-auth", () => ({ PrivyProvider: ({ children }: { children: ReactNode }) => children, usePrivy: () => mocks.privy }));
vi.mock("@privy-io/react-auth/extended-chains", () => ({ useCreateWallet: () => ({ createWallet: mocks.createWallet }), useSignRawHash: () => ({ signRawHash: mocks.signRawHash }) }));
vi.mock("@/lib/privy-near", () => ({ createPrivyNearTransport: () => ({ caller: { functionCall: mocks.baseCall }, sendActions: mocks.baseSend }) }));
vi.mock("@/lib/session-client", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/session-client")>(), createPrivySession: mocks.createPrivySession, clearSession: mocks.clearSession }));
import { AuthProvider, useAuth, type AuthState } from "@/components/AuthProvider";
const identity = { walletAddress: "a".repeat(64), providerUserId: "did:privy:alice", email: "alice@example.com" };
let state: AuthState;
let queryClient: ReturnType<typeof useQueryClient>;
let root: Root;
const seen: string[] = [];
function Probe() {
  const current = useAuth(); const currentClient = useQueryClient();
  useEffect(() => { state = current; queryClient = currentClient; seen.push(current.status); }, [current, currentClient]);
  return <span>{current.status}</span>;
}
async function render() { await act(async () => { root.render(<AuthProvider><Probe /></AuthProvider>); }); }
function signIn() {
  mocks.privy.authenticated = true;
  mocks.privy.user = { id: identity.providerUserId, linkedAccounts: [{ type: "wallet", chainType: "near", walletClientType: "privy", address: identity.walletAddress }] };
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear(); seen.length = 0;
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "test-app");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(mocks.privy, { ready: true, authenticated: false, user: null });
  mocks.clearSession.mockResolvedValue(undefined);
  mocks.createPrivySession.mockReset().mockResolvedValue(identity);
  mocks.baseCall.mockResolvedValue({ success: true }); mocks.baseSend.mockResolvedValue({ success: true });
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllEnvs(); });
describe("Privy-only authentication", () => {
  it("opens Privy and ignores the obsolete wallet-selector preference", async () => {
    localStorage.setItem("allocard_auth_method", "wallet");
    await render();
    await act(async () => { if (state.status === "unauthenticated") state.connect(); });
    expect(mocks.privy.login).toHaveBeenCalledTimes(1);
  });
  it("fails clearly when Privy is not configured", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", ""); await render();
    expect(state).toMatchObject({ status: "unauthenticated", error: expect.stringContaining("not configured") });
  });
  it("leaves connecting state when Privy logs out during session creation", async () => {
    signIn(); mocks.createPrivySession.mockImplementationOnce(() => new Promise(() => {}));
    await render(); expect(state.status).toBe("connecting");
    mocks.privy.authenticated = false; mocks.privy.user = null;
    await render(); expect(state.status).toBe("unauthenticated");
    expect(mocks.clearSession).toHaveBeenCalled();
  });
  it("keeps renewal callback stable and preserves wallet visibility", async () => {
    signIn(); await render(); expect(state.status).toBe("authenticated");
    if (state.status !== "authenticated") throw new Error("Expected authentication");
    const renew = state.establishSession;
    seen.length = 0;
    mocks.createPrivySession.mockResolvedValue({ ...identity });
    await act(async () => { await renew(); });
    await render();
    expect(state.status === "authenticated" && state.establishSession).toBe(renew);
    expect(seen).not.toContain("connecting");
    expect(mocks.createPrivySession).toHaveBeenCalledTimes(2);
  });
  it("does not restart bootstrap when SDK callbacks change", async () => {
    signIn(); await render(); seen.length = 0;
    const original = mocks.privy.getAccessToken;
    mocks.privy.getAccessToken = vi.fn();
    try {
      await render();
      expect(mocks.createPrivySession).toHaveBeenCalledTimes(1);
      expect(seen).not.toContain("connecting");
    } finally { mocks.privy.getAccessToken = original; }
  });
  it("hides the previous identity and clears private data when the user changes", async () => {
    signIn(); await render();
    queryClient.setQueryData(["allocard", "private"], "secret");
    mocks.privy.user = { ...mocks.privy.user!, id: "did:privy:bob" };
    mocks.createPrivySession.mockImplementationOnce(() => new Promise(() => {}));
    await render();
    expect(state.status).toBe("connecting");
    expect(queryClient.getQueryData(["allocard", "private"])).toBeUndefined();
    expect(mocks.clearSession).toHaveBeenCalledTimes(1);
  });
  it("invalidates account reads only after a confirmed transaction", async () => {
    signIn(); await render();
    const key = ["allocard", "testnet", identity.providerUserId, identity.walletAddress, "dashboard"];
    queryClient.setQueryData(key, { balance: "1" });
    await act(async () => { if (state.status === "authenticated") await state.sendActions({ receiverId: "treasury.testnet", actions: [] }); });
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true);
    queryClient.setQueryData(key, { balance: "1" });
    mocks.baseSend.mockRejectedValueOnce(new Error("Rejected"));
    await act(async () => {
      if (state.status === "authenticated") await expect(state.sendActions({ receiverId: "treasury.testnet", actions: [] })).rejects.toThrow("Rejected");
    });
    expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false);
  });
});
