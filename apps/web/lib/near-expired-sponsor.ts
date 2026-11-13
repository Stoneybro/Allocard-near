import { createHash } from "node:crypto";
import { SignedTransaction, encodeTransaction } from "near-api-js/lib/transaction";
import { utils } from "near-api-js";
import { nearQuery } from "./near-server";
import { nextAccessKeyNonce } from "./near-nonce";
import { SPONSORED_VALID_BLOCKS } from "./near-sponsored-action";
import { archiveExpiredUnusedSponsorJob, type SponsorJob } from "./near-sponsor-store";

/** Call only after authorized intent matching and an explicit UNKNOWN_TRANSACTION. */
export async function archiveExpiredUnusedDelegate(job: SponsorJob, intentHash: string): Promise<boolean> {
  if (job.intentHash !== intentHash) throw new Error("Restore the original agent policy before recovering its transaction.");
  if (job.state !== "submitted" || !job.transactionHash || !job.signedTransaction || !/^[0-9a-f]{64}$/.test(job.actor)) return false;
  const signed = SignedTransaction.decode(Buffer.from(job.signedTransaction, "base64"));
  const tx = signed.transaction;
  const hash = utils.serialize.base_encode(createHash("sha256").update(encodeTransaction(tx)).digest());
  const delegate = tx.actions.length === 1 ? tx.actions[0].signedDelegate?.delegateAction : null;
  const key = delegate?.publicKey as unknown as { ed25519Key?: { data: Uint8Array } } | undefined;
  if (hash !== job.transactionHash || tx.signerId !== job.relayerId || tx.receiverId !== job.actor || delegate?.senderId !== job.actor || !key?.ed25519Key || Buffer.from(key.ed25519Key.data).toString("hex") !== job.actor) throw new Error("Saved sponsor transaction could not be verified.");
  // A freshly recreated key starts near block_height * 1e6. Stay strictly below
  // that floor at the earliest possible signing height, so key replacement
  // cannot masquerade as an unused nonce. Ambiguous cases remain journaled.
  const earliestHeight = delegate.maxBlockHeight - BigInt(SPONSORED_VALID_BLOCKS);
  if (earliestHeight <= 1n || delegate.nonce >= (earliestHeight - 1n) * 1_000_000n) return false;
  const access = await nearQuery({ request_type: "view_access_key", account_id: job.actor,
    public_key: `ed25519:${utils.serialize.base_encode(Buffer.from(job.actor, "hex"))}`, finality: "final" });
  if (access.permission !== "FullAccess" || !Number.isSafeInteger(access.block_height) || BigInt(access.block_height) <= delegate.maxBlockHeight || nextAccessKeyNonce(access.nonce) - 1n >= delegate.nonce) return false;
  return archiveExpiredUnusedSponsorJob(job.id, job.transactionHash);
}
