vi.mock("server-only", () => ({}));
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { sponsoredRevokeDelegate, sponsoredSigningBytes } from "@/lib/near-sponsored-action";
const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], identity: vi.fn(), user: vi.fn(), permission: vi.fn(), submit: vi.fn(), recover: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: () => { const builder = { from: () => builder, where: () => builder, limit: async () => mocks.rows.shift() ?? [] }; return builder; } } }));
vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: mocks.user }));
vi.mock("@/lib/session", () => ({ getSessionIdentity: mocks.identity }));
vi.mock("@/lib/near-sponsor-store", () => ({ findSponsorJob: async () => null }));
vi.mock("@/lib/near-sponsor-server", () => ({ sponsorConfig: vi.fn(), assertTestnet: async () => {}, ensureSigningAccount: async () => ({ nonce: "1", block_height: 100 }), submitOuter: mocks.submit, recover: mocks.recover }));
vi.mock("@/lib/near-server", () => ({ verifyTreasuryOwner: async () => ({ paused: true }), nearQuery: async () => ({ permission: "FullAccess", nonce: "1", block_height: 100 }), treasuryReader: () => ({ getPermission: mocks.permission }) }));
import { prepareSponsoredRevoke, submitSponsoredRevoke } from "@/lib/near-revoke-sponsor-server";
const key = generateKeyPairSync("ed25519");
const actor = key.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const input = { treasury: `shared.testnet#${"c".repeat(64)}`, permissionId: "9" };
function proof() { const delegate = sponsoredRevokeDelegate(actor, input, "2", "220"); return { ...input, nonce: "2", maxBlockHeight: "220", signature: `0x${sign(null, createHash("sha256").update(sponsoredSigningBytes(delegate)).digest(), key.privateKey).toString("hex")}` }; }
function employeeRows() { mocks.rows = [[{ id: "company", ownerId: "owner" }], [{ id: "employee-membership" }], [{ id: "my-agent" }], [{ nearAccountId: "owner.testnet" }]]; }
beforeEach(() => {
  vi.clearAllMocks(); employeeRows();
  mocks.identity.mockResolvedValue({ walletAddress: actor, providerUserId: "did:privy:actor" }); mocks.user.mockResolvedValue({ id: "employee", privyUserId: "did:privy:actor" });
  mocks.permission.mockResolvedValue({ issuer: actor, revoked: false });
  mocks.submit.mockResolvedValue({ transaction: { hash: "revocation", signer_id: "sponsor.testnet" }, status: { SuccessValue: "" } });
});
it("sponsors an employee's own agent revocation while paused, using no wallet deposit", async () => {
  expect(await prepareSponsoredRevoke(input)).toMatchObject({ enabled: true, nonce: "2" }); employeeRows();
  mocks.permission.mockResolvedValueOnce({ issuer: actor, revoked: false }).mockResolvedValueOnce({ issuer: actor, revoked: true });
  expect((await submitSponsoredRevoke(proof())).outcome?.transaction.hash).toBe("revocation");
  const [, owner, , receiver, actions] = mocks.submit.mock.calls[0];
  expect(owner).toBe(actor); expect(receiver).toBe(actor);
  expect(actions[0].signedDelegate.delegateAction.actions[0].functionCall).toMatchObject({ methodName: "revoke_permission", deposit: 0n });
});
it("lets the employer revoke company permissions issued by an employee", async () => {
  mocks.user.mockResolvedValue({ id: "owner", privyUserId: "did:privy:actor" });
  mocks.rows = [[{ id: "company", ownerId: "owner" }], [{ id: "owner-membership" }], [{ nearAccountId: actor }]];
  mocks.permission.mockResolvedValue({ issuer: "another-employee.testnet", revoked: false });
  expect(await prepareSponsoredRevoke(input)).toMatchObject({ enabled: true });
});
it("rejects another employee's permission and treats already-revoked access idempotently", async () => {
  mocks.rows[2] = []; await expect(prepareSponsoredRevoke(input)).rejects.toThrow("own agent");
  employeeRows(); mocks.permission.mockResolvedValue({ issuer: "someone-else.testnet", revoked: false });
  await expect(prepareSponsoredRevoke(input)).rejects.toThrow("cannot revoke");
  employeeRows(); mocks.permission.mockResolvedValue({ issuer: actor, revoked: true });
  expect(await prepareSponsoredRevoke(input)).toEqual({ enabled: true, revoked: true });
  expect(mocks.submit).not.toHaveBeenCalled();
});
