import { beforeEach, describe, expect, it, vi } from "vitest";
const identity = { walletAddress: "a".repeat(64), providerUserId: "did:privy:alice", email: "alice@example.com" };
const deferred = <T,>() => { let resolve!: (value: T) => void; const promise = new Promise<T>(r => { resolve = r; }); return { promise, resolve }; };
beforeEach(() => { vi.resetModules(); vi.unstubAllGlobals(); });
describe("session lifecycle", () => {
  it("waits for logout before a new Privy exchange", async () => {
    const deleted = deferred<Response>();
    const started = deferred<void>();
    const fetchMock = vi.fn().mockImplementationOnce(() => { started.resolve(); return deleted.promise; }).mockResolvedValueOnce(Response.json(identity));
    vi.stubGlobal("fetch", fetchMock);
    const { createPrivySession, clearSession } = await import("@/lib/session-client");
    const logout = clearSession(); await started.promise;
    const login = createPrivySession(identity.walletAddress, async () => "token");
    expect(fetchMock).toHaveBeenCalledTimes(1);
    deleted.resolve(new Response(null, { status: 204 }));
    await logout; expect(await login).toEqual(identity);
    expect(fetchMock.mock.calls.map(call => call[1]?.method)).toEqual(["DELETE", "POST"]);
  });
  it("waits for a pending login response before deleting its cookie", async () => {
    const response = deferred<Response>();
    const started = deferred<void>();
    const fetchMock = vi.fn().mockImplementationOnce(() => { started.resolve(); return response.promise; }).mockResolvedValueOnce(new Response(null, { status: 204 }));
    vi.stubGlobal("fetch", fetchMock);
    const { createPrivySession, clearSession } = await import("@/lib/session-client");
    const login = createPrivySession(identity.walletAddress, async () => "token");
    await started.promise;
    const rejected = expect(login).rejects.toThrow("cancelled");
    const logout = clearSession();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    response.resolve(Response.json(identity));
    await Promise.all([rejected, logout]);
    expect(fetchMock.mock.calls.map(call => call[1].method)).toEqual(["POST", "DELETE"]);
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

describe("Privy session recovery", () => {
  it("deduplicates concurrent exchanges", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(identity)));
    const { createPrivySession } = await import("@/lib/session-client");
    const getToken = vi.fn().mockResolvedValue("token");
    const first = createPrivySession(identity.walletAddress, getToken);
    const second = createPrivySession(identity.walletAddress, getToken);
    expect(first).toBe(second);
    await first;
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each(["TOKEN_EXPIRED", "AUTH_UNAVAILABLE"])("recovers from %s with a current token", async code => {
    vi.useFakeTimers();
    try {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json({ code }, { status: code === "TOKEN_EXPIRED" ? 401 : 503 })).mockResolvedValueOnce(Response.json(identity)));
      const { createPrivySession } = await import("@/lib/session-client");
      const getToken = vi.fn().mockResolvedValueOnce("old").mockResolvedValueOnce("new");
      const task = createPrivySession(identity.walletAddress, getToken);
      await vi.runAllTimersAsync();
      expect(await task).toEqual(identity);
      expect(getToken).toHaveBeenCalledTimes(2);
    } finally { vi.useRealTimers(); }
  });
  it("does not retry invalid signatures", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "TOKEN_INVALID", error: "Invalid token" }, { status: 401 })));
    const { createPrivySession } = await import("@/lib/session-client");
    await expect(createPrivySession(identity.walletAddress, async () => "token")).rejects.toThrow("Invalid token");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

it("bounds retries when the authentication provider stays unavailable", async () => {
  vi.useFakeTimers();
  try {
    vi.stubGlobal("fetch", vi.fn().mockImplementation(async () => Response.json({ code: "AUTH_UNAVAILABLE", error: "Unavailable" }, { status: 503 })));
    const { createPrivySession } = await import("@/lib/session-client");
    const rejected = expect(createPrivySession(identity.walletAddress, async () => "token")).rejects.toThrow("Unavailable");
    await vi.runAllTimersAsync();
    await rejected;
    expect(fetch).toHaveBeenCalledTimes(3);
  } finally { vi.useRealTimers(); }
});
