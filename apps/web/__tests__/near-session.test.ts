import { SignJWT } from "jose";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn(), verify: vi.fn(), lookup: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.lookup }) }) }) } }));
vi.mock("@/lib/session-store", () => ({ SessionRevokedError: class extends Error {}, issueSession: async () => "x".repeat(43), readSession: async (token: string) => token === "x".repeat(43) ? ({ walletAddress: "a".repeat(64), providerUserId: "did:privy:alice", email: "alice@example.com" }) : null, revokeSession: vi.fn(), SESSION_ABSOLUTE_SECONDS: 86400 }));
vi.mock("next/headers", () => ({ cookies: async () => mocks }));
vi.mock("@/lib/privy-server", async importOriginal => ({ ...await importOriginal<typeof import("@/lib/privy-server")>(), verifyPrivySession: mocks.verify }));
import { POST } from "@/app/api/auth/session/route";
import { PrivySessionError } from "@/lib/privy-server";
import { getSessionIdentity } from "@/lib/session";
import { sessionSecret } from "@/lib/session-secret";
const origin = "http://localhost:3000";
const identity = { walletAddress: "a".repeat(64), providerUserId: "did:privy:alice", email: "alice@example.com" };
function request(body: unknown, requestOrigin = origin) { return new Request(`${origin}/api/auth/session`, { method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.lookup.mockResolvedValue([]); mocks.verify.mockResolvedValue(identity); mocks.get.mockReturnValue(undefined); });
describe("Privy-only server sessions", () => {
  it.each([{}, null, { accountId: "employee.testnet", publicKey: "key", signature: "proof" }, { accessToken: "token", accountId: "0x123" }])("rejects obsolete wallet proofs and malformed input", async body => {
    expect((await POST(request(body))).status).toBe(400);
    expect(mocks.verify).not.toHaveBeenCalled(); expect(mocks.set).not.toHaveBeenCalled();
  });
  it("rejects cross-origin login", async () => {
    expect((await POST(request({}, "https://attacker.example"))).status).toBe(403);
    expect(mocks.verify).not.toHaveBeenCalled();
  });
  it("issues a Privy session only after server verification", async () => {
    const response = await POST(request({ accessToken: "token", accountId: identity.walletAddress, email: "attacker@example.com" }));
    expect(response.status).toBe(200); expect(await response.json()).toEqual(identity);
    const cookie = mocks.set.mock.calls[0];
    mocks.get.mockReturnValue({ value: cookie[1] });
    expect(await getSessionIdentity()).toEqual(identity);
    expect(cookie[2]).toMatchObject({ httpOnly: true, sameSite: "lax" });
  });
  it("rejects old wallet-only cookies", async () => {
    const token = await new SignJWT({ walletAddress: "alice.testnet", email: "alice.testnet@near", authVersion: 2 })
      .setProtectedHeader({ alg: "HS256" }).setSubject("near:alice.testnet").setExpirationTime("1h").sign(sessionSecret());
    mocks.get.mockReturnValue({ value: token });
    expect(await getSessionIdentity()).toBeNull();
  });
  it.each([
    ["AUTH_UNAVAILABLE", 503], ["TOKEN_EXPIRED", 401], ["TOKEN_INVALID", 401], ["AUTH_CONFIGURATION", 500], ["IDENTITY_NOT_LINKED", 403],
  ])("returns %s with its status and no session cookie", async (code, status) => {
    mocks.verify.mockRejectedValueOnce(new PrivySessionError(code, "Sign-in failed", status));
    const response = await POST(request({ accessToken: "token", accountId: identity.walletAddress }));
    expect(response.status).toBe(status);
    expect(await response.json()).toEqual({ code, error: "Sign-in failed" });
    expect(response.headers.get("Retry-After")).toBe(status === 503 ? "1" : null);
    expect(mocks.set).not.toHaveBeenCalled();
  });
});
