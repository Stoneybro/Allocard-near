import { createHash } from "node:crypto";
import { KeyPair, utils } from "near-api-js";
import { Action, Signature, SignedTransaction, createTransaction, encodeTransaction } from "near-api-js/lib/transaction";
import { beforeEach, expect, it, vi } from "vitest";
import { sponsoredAdapterDelegate } from "@/lib/near-sponsored-action";
import { SPENDING_ASSET } from "@/lib/chain";
import type { SponsorJob } from "@/lib/near-sponsor-store";
const mocks = vi.hoisted(() => ({ query: vi.fn(), archive: vi.fn() }));
vi.mock("@/lib/near-server", () => ({ nearQuery: mocks.query }));
vi.mock("@/lib/near-sponsor-store", () => ({ archiveExpiredUnusedSponsorJob: mocks.archive }));
import { archiveExpiredUnusedDelegate } from "@/lib/near-expired-sponsor";
const actorKey = KeyPair.fromRandom("ed25519"), relayer = KeyPair.fromRandom("ed25519");
const actor = Buffer.from(actorKey.getPublicKey().data).toString("hex");
function job(nonce = "2"): SponsorJob {
  const delegate = sponsoredAdapterDelegate(actor, { treasury: `shared.testnet#${"c".repeat(64)}`, delegationId: "12345678-1234-4234-8234-123456789012", parentId: "1",
    spec: { delegate: "agent.testnet", valid_from_ms: "0", redelegation_depth: 0, rules: [{ asset: SPENDING_ASSET, recipients: { type: "Any" }, lifetime_limit: "10", acknowledge_unbounded_budget: false }] } }, nonce, "220");
  const action = new Action({ signedDelegate: { delegateAction: delegate, signature: new Signature({ keyType: 0, data: new Uint8Array(64) }) } });
  const transaction = createTransaction("relayer.testnet", relayer.getPublicKey(), actor, 1n, [action], new Uint8Array(32));
  const digest = createHash("sha256").update(encodeTransaction(transaction)).digest();
  const signed = new SignedTransaction({ transaction, signature: new Signature({ keyType: 0, data: relayer.sign(digest).signature }) });
  return { id: "job", actor, relayerId: "relayer.testnet", intentHash: "intent", state: "submitted", transactionHash: utils.serialize.base_encode(digest), signedTransaction: Buffer.from(signed.encode()).toString("base64"), createdAt: new Date() };
}
beforeEach(() => { vi.clearAllMocks(); mocks.query.mockResolvedValue({ permission: "FullAccess", nonce: "1", block_height: 221 }); mocks.archive.mockResolvedValue(true); });
it("archives only after exact saved bytes and a finalized unused nonce beyond delegate expiry", async () => {
  const saved = job(); expect(await archiveExpiredUnusedDelegate(saved, "intent")).toBe(true);
  expect(mocks.query).toHaveBeenCalledWith(expect.objectContaining({ account_id: actor, finality: "final", request_type: "view_access_key" }));
  expect(mocks.archive).toHaveBeenCalledWith(saved.id, saved.transactionHash);
});
it.each([{ nonce: "2", block_height: 221 }, { nonce: "3", block_height: 221 }, { nonce: "1", block_height: 220 }, { nonce: "1", block_height: 219 }])("retains consumed or still-executable attempts: %o", async access => {
  mocks.query.mockResolvedValue({ permission: "FullAccess", ...access });
  expect(await archiveExpiredUnusedDelegate(job(), "intent")).toBe(false); expect(mocks.archive).not.toHaveBeenCalled();
});
it("rejects altered intent or bytes and preserves the journal", async () => {
  await expect(archiveExpiredUnusedDelegate(job(), "different")).rejects.toThrow("original agent policy");
  await expect(archiveExpiredUnusedDelegate({ ...job(), transactionHash: "tampered" }, "intent")).rejects.toThrow("could not be verified");
  expect(mocks.archive).not.toHaveBeenCalled();
});
it("does not infer nonexecution from an RPC failure or a potentially recreated key", async () => {
  mocks.query.mockRejectedValueOnce(new Error("RPC unavailable"));
  await expect(archiveExpiredUnusedDelegate(job(), "intent")).rejects.toThrow("RPC unavailable");
  expect(await archiveExpiredUnusedDelegate(job("99000000"), "intent")).toBe(false);
  expect(mocks.archive).not.toHaveBeenCalled();
});
