import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WalletSelector } from "@near-wallet-selector/core";
const identity = { walletAddress: "alice.testnet", providerUserId: "near:alice.testnet", email: "alice.testnet@near" };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });
describe("session lifecycle", () => {
  it("waits for logout before checking whether a reconnect can reuse the session", async () => {
    const deleted = deferred<Response>();
    const started = deferred<void>();
    const fetchMock = vi.fn()
      .mockImplementationOnce(() => { started.resolve(); return deleted.promise; })
      .mockResolvedValueOnce(new Response(null, { status: 401 }))
      .mockResolvedValueOnce(Response.json({ nonce: "", recipient: "http://localhost", message: "login" }))
      .mockResolvedValueOnce(Response.json(identity));
    vi.stubGlobal("fetch", fetchMock);
    const selector = { wallet: async () => ({ id: "meteor-wallet", signMessage: async () => ({ accountId: identity.walletAddress }) }) } as unknown as WalletSelector;
    const { createSession, clearSession } = await import("@/lib/session-client");
    const logout = clearSession();
    await started.promise;
    const login = createSession(identity.walletAddress, selector);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    deleted.resolve(new Response(null, { status: 204 }));
    await logout;
    expect(await login).toEqual(identity);
    expect(fetchMock.mock.calls.map(call => call[1]?.method ?? "GET")).toEqual(["DELETE", "GET", "POST", "POST"]);
  });
  it("waits for a pending login response before deleting its cookie", async () => {
    const response = deferred<Response>();
    const started = deferred<void>();
    const fetchMock = vi.fn().mockImplementationOnce(() => { started.resolve(); return response.promise; }).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { createPrivySession, clearSession } = await import("@/lib/session-client");
    const login = createPrivySession(identity.walletAddress, async () => "token");
    await started.promise;
    const logout = clearSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    response.resolve(Response.json(identity));
    await Promise.all([login, logout]);
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["POST", "DELETE"]);
  });
  it("does not post a wallet proof after logout while the wallet prompt is open", async () => {
    const proof = deferred<{ accountId: string }>();
    const prompted = deferred<void>();
    const fetchMock = vi.fn().mockResolvedValueOnce(new Response(null, { status: 401 })).mockResolvedValueOnce(Response.json({ nonce: "", recipient: "http://localhost", message: "login" })).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const selector = { wallet: async () => ({ id: "meteor-wallet", signMessage: () => { prompted.resolve(); return proof.promise; } }) } as unknown as WalletSelector;
    const { createSession, clearSession } = await import("@/lib/session-client");
    const login = createSession(identity.walletAddress, selector);
    const rejected = expect(login).rejects.toThrow("cancelled");
    await prompted.promise;
    await clearSession();
    proof.resolve({ accountId: identity.walletAddress });
    await rejected;
    expect(fetchMock.mock.calls.filter(call => call[0] === "/api/auth/session" && call[1]?.method === "POST")).toHaveLength(0);
  });
  it("obtains a fresh Privy token for session renewal", async () => {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json(identity)));
    const { createPrivySession } = await import("@/lib/session-client");
    const getToken = vi.fn().mockResolvedValueOnce("first").mockResolvedValueOnce("renewed");
    await createPrivySession(identity.walletAddress, getToken);
    await createPrivySession(identity.walletAddress, getToken);
    expect(JSON.parse(vi.mocked(fetch).mock.calls[1][1]!.body as string).accessToken).toBe("renewed");
  });
});
