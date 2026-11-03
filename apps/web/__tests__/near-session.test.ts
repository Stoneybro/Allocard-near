import { generateKeyPairSync, randomBytes, sign } from "node:crypto";
import { SignJWT } from "jose";
import { utils } from "near-api-js";
import { beforeEach, describe, expect, it, vi } from "vitest";
const store = vi.hoisted(() => ({ get: vi.fn(), set: vi.fn(), delete: vi.fn(), consumed: [] as unknown[] }));
vi.mock("@/lib/db", () => ({ db: { insert: () => ({ values: () => ({ onConflictDoNothing: () => ({ returning: async () => store.consumed }) }) }) } }));
vi.mock("next/headers", () => ({ cookies: async () => store }));
vi.mock("@/lib/near-server", () => ({ nearQuery: vi.fn() }));
import { POST } from "@/app/api/auth/session/route";
import { nearQuery } from "@/lib/near-server";
import { sessionSecret } from "@/lib/session-secret";
import { loginDigest } from "@/lib/near-proof";
import { getSessionIdentity } from "@/lib/session";
const origin = "http://localhost:3000";
const { privateKey, publicKey } = generateKeyPairSync("ed25519");
const key = `ed25519:${utils.serialize.base_encode(publicKey.export({ format: "der", type: "spki" }).subarray(-32))}`;
function request(body: unknown, requestOrigin = origin) { return new Request(`${origin}/api/auth/session`, { method: "POST", headers: { Origin: requestOrigin, "Content-Type": "application/json" }, body: JSON.stringify(body) }); }
async function signedLogin(recipient = origin) {
  const challenge = { accountId: "employee.testnet", recipient, message: "Sign in", nonce: randomBytes(32).toString("base64") };
  const token = await new SignJWT(challenge).setProtectedHeader({ alg: "HS256" }).setAudience("allocard-login").setExpirationTime("5m").sign(sessionSecret());
  store.get.mockReturnValue({ value: token });
  return { accountId: challenge.accountId, publicKey: key, signature: sign(null, loginDigest(challenge), privateKey).toString("base64") };
}
beforeEach(() => { vi.resetAllMocks(); store.consumed = [{ nonceHash: "nonce" }]; });
describe("verified server sessions", () => {
  it("rejects account/email assertions without a signed challenge", async () => {
    const response = await POST(request({ accountId: "victim.testnet", email: "victim@example.com" }));
    expect(response.status).toBe(401); expect(nearQuery).not.toHaveBeenCalled(); expect(store.set).not.toHaveBeenCalled();
  });
  it("rejects cross-origin login", async () => expect((await POST(request({}, "https://attacker.example"))).status).toBe(403));
  it("checks the signing key against the account and requires full access", async () => {
    const proof = await signedLogin(); vi.mocked(nearQuery).mockResolvedValue({ permission: { FunctionCall: {} } });
    expect((await POST(request(proof))).status).toBe(401); expect(store.set).not.toHaveBeenCalled();
  });
  it("issues a session only after signature and on-chain key verification", async () => {
    const proof = await signedLogin(); vi.mocked(nearQuery).mockResolvedValue({ permission: "FullAccess" });
    const response = await POST(request({ ...proof, email: "unverified@example.com" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ walletAddress: "employee.testnet", email: "employee.testnet@near" });
    expect(nearQuery).toHaveBeenCalledWith(expect.objectContaining({ account_id: proof.accountId, public_key: proof.publicKey }));
    expect(store.delete).toHaveBeenCalledWith("allocard_login_challenge"); expect(store.set).toHaveBeenCalled();
  });
  it("verifies a public-domain challenge behind a reverse proxy", async () => {
    const publicOrigin = "https://allocard.example";
    const proof = await signedLogin(publicOrigin);
    vi.mocked(nearQuery).mockResolvedValue({ permission: "FullAccess" });
    const response = await POST(new Request(`${origin}/api/auth/session`, {
      method: "POST", headers: { origin: publicOrigin, host: "localhost:3000", "x-forwarded-host": "allocard.example", "x-forwarded-proto": "https", "Content-Type": "application/json" }, body: JSON.stringify(proof),
    }));
    expect(response.status).toBe(200);
    expect(store.set).toHaveBeenCalled();
  });
  it("rejects reuse of a consumed sign-in challenge", async () => {
    const proof = await signedLogin(); vi.mocked(nearQuery).mockResolvedValue({ permission: "FullAccess" });
    store.consumed = [];
    expect((await POST(request(proof))).status).toBe(401);
    expect(store.set).not.toHaveBeenCalled();
  });
  it("rejects legacy sessions issued without ownership verification", async () => {
    const token = await new SignJWT({ walletAddress: "victim.testnet", email: "victim@example.com" }).setProtectedHeader({ alg: "HS256" }).setSubject("near:victim.testnet").setExpirationTime("1h").sign(sessionSecret());
    store.get.mockReturnValue({ value: token });
    expect(await getSessionIdentity()).toBeNull();
  });
});
