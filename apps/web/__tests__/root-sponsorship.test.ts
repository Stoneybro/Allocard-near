vi.mock("server-only", () => ({}));
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, expect, it, vi } from "vitest";
import { sponsoredRootDelegate, sponsoredSigningBytes, canonicalSponsorJson } from "@/lib/near-sponsored-action";
import { SPENDING_ASSET } from "@/lib/chain";
const mocks = vi.hoisted(() => ({ identity: vi.fn(), user: vi.fn(), rows: [] as unknown[][], budget: "100", owner: vi.fn(), getPermission: vi.fn(), blocked: false, job: null as unknown, submit: vi.fn(), relay: vi.fn(), signing: vi.fn(), release: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: () => { const builder = { from: () => builder, innerJoin: () => builder, where: () => builder, limit: async () => mocks.rows.shift() ?? [] }; return builder; } } }));
vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: mocks.user }));
vi.mock("@/lib/session", () => ({ getSessionIdentity: mocks.identity }));
vi.mock("@/lib/near-sponsor-store", () => ({ findSponsorJob: async () => mocks.job, releaseFailedRootPermissionJob: mocks.release }));
vi.mock("@/lib/near-sponsor-server", () => ({ sponsorConfig: vi.fn(), assertTestnet: async () => {}, ensureSigningAccount: mocks.signing, submitOuter: mocks.submit, relayRpc: mocks.relay }));
vi.mock("@/lib/near-server", () => ({
  verifyTreasuryOwner: mocks.owner,
  nearQuery: async () => ({ permission: "FullAccess", nonce: "1", block_height: 100 }),
  treasuryReader: () => ({ contractId: "shared.testnet", companyId: "company", getTreasuryBudget: async () => ({ unallocated: mocks.budget }), getAssetLedger: async () => ({ enabled: true }), getPermission: mocks.getPermission,
    caller: { viewFunction: async () => mocks.blocked } }),
}));
import { prepareSponsoredRoot, submitSponsoredRoot, RootPermissionFailedError } from "@/lib/near-root-sponsor-server";
const key = generateKeyPairSync("ed25519");
const actor = key.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const input = { treasury: `shared.testnet#${"c".repeat(64)}`, delegationId: "12345678-1234-4234-8234-123456789012",
  spec: { delegate: "employee.testnet", valid_from_ms: "0", expires_at_ms: null, max_executions: null, redelegation_depth: 1, metadata_hash: null,
    rules: [{ asset: SPENDING_ASSET, recipients: { type: "Any" as const }, min_per_action: null, max_per_action: null, lifetime_limit: "50", fixed_window: null, streaming: null, approval: null, acknowledge_unbounded_budget: false }] } };
function rows() { mocks.rows = [[{ id: "company", ownerId: "owner", smartAccountAddress: input.treasury }], [{ id: "owner-membership" }], [{ delegatorType: "company", delegatorId: "company", delegateeType: "user", delegateeId: "employee", status: "pending_config" }], [{ account: "employee.testnet" }]]; }
function proof() {
  const delegate = sponsoredRootDelegate(actor, input, "2", "220");
  const digest = createHash("sha256").update(sponsoredSigningBytes(delegate)).digest();
  return { ...input, nonce: "2", maxBlockHeight: "220", signature: `0x${sign(null, digest, key.privateKey).toString("hex")}` };
}
const outcome = () => ({ transaction: { hash: "original-transaction", signer_id: "sponsor.testnet" }, status: { SuccessValue: "" }, receipts_outcome: [{ outcome: { executor_id: "shared.testnet", status: { SuccessValue: Buffer.from(JSON.stringify("9")).toString("base64") } } }] });
beforeEach(() => {
  vi.clearAllMocks(); mocks.job = null; mocks.budget = "100"; mocks.blocked = false; rows();
  mocks.identity.mockResolvedValue({ walletAddress: actor, providerUserId: "did:privy:owner" }); mocks.user.mockResolvedValue({ id: "owner", privyUserId: "did:privy:owner" });
  mocks.owner.mockResolvedValue({ owner: actor, schema_version: 5, paused: false });
  mocks.signing.mockResolvedValue({ nonce: "1", block_height: 100 });
  mocks.getPermission.mockResolvedValue({ ...input.spec, id: "9", parent_id: null, issuer: actor, revoked: false });
  mocks.submit.mockResolvedValue(outcome()); mocks.relay.mockResolvedValue(outcome());
});
it("lets an employer with no wallet funds sign a zero-deposit allowance paid by the relayer", async () => {
  const quote = await prepareSponsoredRoot(input);
  expect(quote).toMatchObject({ enabled: true, nonce: "2" }); rows();
  const result = await submitSponsoredRoot(proof());
  expect(result.outcome?.rootPermissionId).toBe("9");
  const [, owner, , receiver, actions] = mocks.submit.mock.calls[0];
  expect(owner).toBe(actor); expect(receiver).toBe(actor);
  const delegate = actions[0].signedDelegate.delegateAction;
  expect(delegate.senderId).toBe(actor); expect(delegate.receiverId).toBe("shared.testnet");
  expect(delegate.actions).toHaveLength(1);
  expect(delegate.actions[0].functionCall).toMatchObject({ methodName: "create_root_permission", deposit: 0n, gas: 80000000000000n });
});
it("rejects another company, a spoofed employee, a changed signature and an unfunded allocation", async () => {
  mocks.rows[0] = []; await expect(prepareSponsoredRoot(input)).rejects.toThrow("company owner");
  rows(); mocks.rows[3] = [{ account: "other.testnet" }]; await expect(prepareSponsoredRoot(input)).rejects.toThrow("accepted employee");
  rows(); await expect(submitSponsoredRoot({ ...proof(), signature: `0x${"00".repeat(64)}` })).rejects.toThrow("signature");
  rows(); mocks.budget = "49"; await expect(submitSponsoredRoot(proof())).rejects.toThrow("unallocated");
  expect(mocks.submit).not.toHaveBeenCalled();
});
it("recovers a durable allowance instead of signing or allocating again, even after it used the available funds", async () => {
  mocks.job = { intentHash: createHash("sha256").update(canonicalSponsorJson(input)).digest("hex"), transactionHash: "original-transaction", relayerId: "sponsor.testnet" };
  mocks.budget = "0";
  expect((await prepareSponsoredRoot(input)).outcome?.rootPermissionId).toBe("9");
  expect(mocks.submit).not.toHaveBeenCalled(); expect(mocks.signing).not.toHaveBeenCalled();
});
it("keeps ambiguous receipts journaled and only releases a proven failed atomic allowance", async () => {
  mocks.submit.mockResolvedValueOnce({ ...outcome(), receipts_outcome: [] });
  await expect(submitSponsoredRoot(proof())).rejects.toThrow("permission ID is unavailable");
  expect(mocks.release).not.toHaveBeenCalled(); rows();
  mocks.submit.mockResolvedValueOnce({ ...outcome(), receipts_outcome: [{ outcome: { executor_id: "shared.testnet", status: { Failure: { error: "budget changed" } } } }] });
  await expect(submitSponsoredRoot(proof())).rejects.toBeInstanceOf(RootPermissionFailedError);
  expect(mocks.release).toHaveBeenCalledTimes(1);
});
