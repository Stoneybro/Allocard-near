import { beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPair, SignJWT, exportSPKI } from "jose";
const mocks = vi.hoisted(() => ({ key: vi.fn(), getUser: vi.fn() }));
vi.mock("jose", async importOriginal => ({ ...await importOriginal<typeof import("jose")>(), createRemoteJWKSet: () => mocks.key }));
vi.mock("@privy-io/node", async importOriginal => {
  const actual = await importOriginal<typeof import("@privy-io/node")>();
  return { ...actual, PrivyClient: class { users() { return { _get: mocks.getUser }; } } };
});
const address = "ab".repeat(32);
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks();
  vi.stubEnv("PRIVY_APP_ID", "app"); vi.stubEnv("NEXT_PUBLIC_PRIVY_APP_ID", "app");
  vi.stubEnv("PRIVY_APP_SECRET", "secret"); vi.stubEnv("PRIVY_JWT_VERIFICATION_KEY", "");
  mocks.getUser.mockResolvedValue({ id: "did:privy:user", linked_accounts: [
    { type: "wallet", chain_type: "near", wallet_client_type: "privy", address }, { type: "email", address: "a@example.com" },
  ] });
});
async function token(options: { audience?: string; expired?: boolean } = {}) {
  const keys = await generateKeyPair("ES256");
  mocks.key.mockResolvedValue(keys.publicKey);
  const jwt = await new SignJWT({ sid: "session" }).setProtectedHeader({ alg: "ES256", typ: "JWT" })
    .setIssuer("privy.io").setAudience(options.audience ?? "app").setSubject("did:privy:user")
    .setIssuedAt().setExpirationTime(options.expired ? "-1h" : "1h").sign(keys.privateKey);
  return { jwt, keys };
}
describe("Privy verification", () => {
  it("reuses the configured client and verifies real signatures", async () => {
    const { jwt } = await token();
    const { privyClient, verifyPrivySession } = await import("@/lib/privy-server");
    expect(privyClient()).toBe(privyClient());
    expect(await verifyPrivySession(jwt, address)).toMatchObject({ walletAddress: address });
  });
  it("reports a signing-key outage as unavailable without looking up a user", async () => {
    const { jwt } = await token(); mocks.key.mockRejectedValue(new TypeError("fetch failed"));
    const { verifyPrivySession } = await import("@/lib/privy-server");
    await expect(verifyPrivySession(jwt, address)).rejects.toMatchObject({ status: 503, code: "AUTH_UNAVAILABLE" });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("rejects wrong audiences and expired tokens", async () => {
    const { verifyPrivySession } = await import("@/lib/privy-server");
    await expect(verifyPrivySession((await token({ audience: "other" })).jwt, address)).rejects.toMatchObject({ status: 401, code: "TOKEN_INVALID" });
    await expect(verifyPrivySession((await token({ expired: true })).jwt, address)).rejects.toMatchObject({ status: 401, code: "TOKEN_EXPIRED" });
    expect(mocks.getUser).not.toHaveBeenCalled();
  });
  it("rejects invalid signatures", async () => {
    const { jwt } = await token(); mocks.key.mockResolvedValue((await generateKeyPair("ES256")).publicKey);
    const { verifyPrivySession } = await import("@/lib/privy-server");
    await expect(verifyPrivySession(jwt, address)).rejects.toMatchObject({ status: 401, code: "TOKEN_INVALID" });
  });
  it("supports a configured public key without a remote lookup", async () => {
    const { jwt, keys } = await token(); vi.stubEnv("PRIVY_JWT_VERIFICATION_KEY", await exportSPKI(keys.publicKey));
    const { verifyPrivySession } = await import("@/lib/privy-server");
    await expect(verifyPrivySession(jwt, address)).resolves.toMatchObject({ walletAddress: address });
    expect(mocks.key).not.toHaveBeenCalled();
  });
  it("fails clearly on mismatched app configuration", async () => {
    vi.stubEnv("PRIVY_APP_ID", "other");
    const { privyClient } = await import("@/lib/privy-server");
    expect(privyClient).toThrow("not configured correctly");
  });
});
