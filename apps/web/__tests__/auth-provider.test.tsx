// @vitest-environment jsdom
import { act, useEffect, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
type TestWalletState = { accounts: { accountId: string }[] };
type TestPrivyUser = { linkedAccounts: { type: string; chainType: string; walletClientType: string; address: string }[] };
const mocks = vi.hoisted(() => ({
  privy: { ready: true, authenticated: false, user: null as TestPrivyUser | null, login: vi.fn(), logout: vi.fn(), getAccessToken: vi.fn() },
  createWallet: vi.fn(), signRawHash: vi.fn(), createPrivySession: vi.fn(), createSession: vi.fn(), clearSession: vi.fn(),
  show: vi.fn(), accounts: [] as { accountId: string }[], listener: null as null | ((state: TestWalletState) => void),
}));
vi.mock("@privy-io/react-auth", () => ({ PrivyProvider: ({ children }: { children: ReactNode }) => children, usePrivy: () => mocks.privy }));
vi.mock("@privy-io/react-auth/extended-chains", () => ({ useCreateWallet: () => ({ createWallet: mocks.createWallet }), useSignRawHash: () => ({ signRawHash: mocks.signRawHash }) }));
vi.mock("@/lib/privy-near", () => ({ createPrivyNearTransport: () => ({ caller: {}, sendActions: vi.fn() }) }));
vi.mock("@/lib/session-client", () => ({ createPrivySession: mocks.createPrivySession, createSession: mocks.createSession, clearSession: mocks.clearSession }));
vi.mock("@near-wallet-selector/core", () => ({ setupWalletSelector: async () => ({ store: {
  getState: () => ({ accounts: mocks.accounts }), observable: { subscribe: (callback: (state: TestWalletState) => void) => { mocks.listener = callback; return { unsubscribe: vi.fn() }; } },
} }) }));
vi.mock("@near-wallet-selector/modal-ui", () => ({ setupModal: () => ({ show: mocks.show }) }));
vi.mock("@near-wallet-selector/meteor-wallet", () => ({ setupMeteorWallet: vi.fn() }));
vi.mock("@near-wallet-selector/my-near-wallet", () => ({ setupMyNearWallet: vi.fn() }));
import { AuthProvider, useAuth, type AuthState } from "@/components/AuthProvider";
const identity = { walletAddress: "a".repeat(64), providerUserId: "privy:alice", email: "alice@example.com" };
let state: AuthState;
let root: Root;
function Probe() {
  const current = useAuth();
  useEffect(() => { state = current; }, [current]);
  return <span>{current.status}</span>;
}
async function render() { await act(async () => { root.render(<AuthProvider><Probe /></AuthProvider>); }); }
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "test-app");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  Object.assign(mocks.privy, { ready: true, authenticated: false, user: null });
  mocks.accounts = []; mocks.listener = null;
  mocks.clearSession.mockResolvedValue(undefined);
  mocks.createPrivySession.mockResolvedValue(identity);
  mocks.createSession.mockResolvedValue(identity);
  root = createRoot(document.createElement("div"));
});
afterEach(async () => { await act(async () => root.unmount()); vi.unstubAllEnvs(); });
describe("authentication provider transitions", () => {
  it("opens the existing-wallet selector when Privy is configured and remembers the choice", async () => {
    await render();
    await act(async () => { if (state.status === "unauthenticated") state.connectExistingWallet(); });
    // Dynamic module loading can finish after the initial act.
    await vi.waitFor(() => expect(mocks.show).toHaveBeenCalled());
    expect(mocks.privy.login).not.toHaveBeenCalled();
    expect(localStorage.getItem("allocard_auth_method")).toBe("wallet");
  });
  it("restores the selected wallet login method on reload", async () => {
    localStorage.setItem("allocard_auth_method", "wallet");
    await render();
    await vi.waitFor(() => expect(mocks.show).toHaveBeenCalled());
    expect(mocks.privy.login).not.toHaveBeenCalled();
  });
  it("leaves connecting state when Privy logs out during session creation", async () => {
    mocks.privy.authenticated = true;
    mocks.privy.user = { linkedAccounts: [{ type: "wallet", chainType: "near", walletClientType: "privy", address: identity.walletAddress }] };
    mocks.createPrivySession.mockImplementationOnce(() => new Promise(() => {}));
    await render(); expect(state.status).toBe("connecting");
    mocks.privy.authenticated = false; mocks.privy.user = null;
    await render();
    expect(state.status).toBe("unauthenticated");
    expect(mocks.clearSession).toHaveBeenCalled();
  });
  it("leaves connecting state when a wallet disconnects during signing", async () => {
    vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "");
    mocks.accounts = [{ accountId: identity.walletAddress }];
    mocks.createSession.mockImplementationOnce(() => new Promise(() => {}));
    await render();
    await vi.waitFor(() => expect(mocks.createSession).toHaveBeenCalled());
    expect(state.status).toBe("connecting");
    await act(async () => { mocks.accounts = []; mocks.listener?.({ accounts: [] }); });
    expect(state.status).toBe("unauthenticated");
    expect(mocks.clearSession).toHaveBeenCalled();
  });
  it("renews the server session when establishSession is requested", async () => {
    mocks.privy.authenticated = true;
    mocks.privy.user = { linkedAccounts: [{ type: "wallet", chainType: "near", walletClientType: "privy", address: identity.walletAddress }] };
    await render(); expect(state.status).toBe("authenticated");
    await act(async () => { if (state.status === "authenticated") await state.establishSession(); });
    expect(mocks.createPrivySession).toHaveBeenCalledTimes(2);
  });
});
