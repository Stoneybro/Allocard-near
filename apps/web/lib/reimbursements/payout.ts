import "server-only";
import { createHash, randomUUID } from "node:crypto";
import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { utils } from "near-api-js";
import { createTransaction, SignedTransaction, Signature, functionCall } from "near-api-js/lib/transaction";
import { type ExecuteRequest, parseTreasuryReference, formatTokenAmount } from "@allocard/delegation-sdk";
import { db } from "../db";
import { reimbursementJobs as jobs, claimRedemptions, companies, users } from "../db/schema";
import { nearQuery, treasuryReader, assertSettledPayment, verifyTreasuryOwner } from "../near-server";
import { nearRpcServerUrl } from "../near-rpc-server";
import { acquireSponsorKey, allocateSponsorNonce, releaseSponsorKey } from "../near-sponsor-store";
import { nextAccessKeyNonce } from "../near-nonce";
import { invalidateNearReadCache } from "../near-read-coordinator";
import { reimbursementSigner } from "./config";

export type PayoutJob = typeof jobs.$inferSelect;
export async function findPayout(id: string) { return (await db.select().from(jobs).where(eq(jobs.id, id)).limit(1))[0] ?? null; }
export async function reservePayout(input: typeof jobs.$inferInsert) {
  const [created] = await db.insert(jobs).values(input).onConflictDoNothing().returning();
  const job = created ?? await findPayout(input.id);
  if (!job || job.intentHash !== input.intentHash || job.employeeId !== input.employeeId) throw new Error("This receipt already belongs to a different claim");
  return job;
}
async function rpc(method: string, params: unknown) {
  const response = await fetch(nearRpcServerUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store", body: JSON.stringify({ jsonrpc: "2.0", id: "reimbursement", method, params }), signal: AbortSignal.timeout(20_000) });
  const payload = await response.json();
  if (!response.ok || payload.error || !payload.result) throw new Error("NEAR payout status is temporarily unavailable");
  return payload.result;
}
async function auditPaid(job: PayoutJob) {
  const review = job.review as { reasoning?: string; prompt?: string; confidence?: number } | null;
  await db.insert(claimRedemptions).values({ reimbursementJobId: job.id, agentId: job.agentId, companyId: job.companyId, employeeId: job.employeeId, delegationHash: (job.request as ExecuteRequest).permission_id,
    claimDescription: job.description, amountNear: formatTokenAmount(job.amountYocto, 24), assetNetwork: "near:testnet", aiApproved: true, aiReasoning: review?.reasoning ?? "Receipt and policy approved", aiPrompt: review?.prompt ?? "", aiConfidence: review?.confidence ?? 0, status: "approved", txHash: job.transactionHash,
  }).onConflictDoNothing({ target: claimRedemptions.reimbursementJobId });
}
export async function reconcilePayout(job: PayoutJob) {
  if (job.state === "paid") { await auditPaid(job); return { claimId: job.id, state: "paid", txHash: job.transactionHash }; }
  if (job.state === "failed" || job.state === "rejected") return { claimId: job.id, state: job.state, txHash: job.transactionHash };
  const reader = treasuryReader(job.treasury);
  const record = await reader.getExecutionByRequest(job.actor, job.id);
  if (!record || record.status === "Pending") return { claimId: job.id, state: "pending", txHash: job.transactionHash };
  if (record.status === "Failed") {
    await db.update(jobs).set({ state: "failed", executionId: record.id }).where(eq(jobs.id, job.id));
    return { claimId: job.id, state: "failed", txHash: job.transactionHash };
  }
  assertSettledPayment(record, { actor: job.actor, permissionId: (job.request as ExecuteRequest).permission_id, receiver: job.recipient, amount: job.amountYocto });
  await db.update(jobs).set({ state: "paid", executionId: record.id }).where(eq(jobs.id, job.id));
  await auditPaid(job);
  return { claimId: job.id, state: "paid", txHash: job.transactionHash };
}
export async function submitPayout(job: PayoutJob) {
  if (job.signedTransaction && job.state === "submitted") {
    const record = await treasuryReader(job.treasury).getExecutionByRequest(job.actor, job.id);
    if (!record) {
      // POST retries may rebroadcast only these exact previously persisted bytes.
      try {
        const outcome = await rpc("send_tx", { signed_tx_base64: job.signedTransaction, wait_until: "FINAL" });
        if (outcome.status && "Failure" in outcome.status) {
          await db.update(jobs).set({ state: "failed" }).where(eq(jobs.id, job.id));
          return { claimId: job.id, state: "failed", txHash: job.transactionHash };
        }
      }
      catch { return { claimId: job.id, state: "pending", txHash: job.transactionHash }; }
    }
    return reconcilePayout(job);
  }
  if (job.state !== "approved") return reconcilePayout(job);
  const signer = reimbursementSigner();
  if (!signer || signer.accountId !== job.actor) throw new Error("Reimbursement signer is unavailable");
  const network = await rpc("status", {});
  if (network.chain_id !== "testnet") throw new Error("Reimbursement signing is restricted to NEAR testnet");
  const [company] = await db.select({ owner: sql<string>`coalesce(${users.nearAccountId}, ${users.embeddedWalletAddress})` }).from(companies).innerJoin(users, eq(users.id, companies.ownerId)).where(eq(companies.id, job.companyId)).limit(1);
  if (!company?.owner) throw new Error("The company treasury owner is unavailable");
  await verifyTreasuryOwner(job.treasury, company.owner);
  const scope = parseTreasuryReference(job.treasury);
  const request = job.request as ExecuteRequest;
  if (request.request_id !== job.id || request.action.asset.type !== "NativeNear" || request.action.receiver !== job.recipient || request.action.amount !== job.amountYocto) throw new Error("Stored payout intent is inconsistent");
  const reader = treasuryReader(job.treasury);
  if (await reader.getExecutionByRequest(job.actor, job.id)) return reconcilePayout(job);
  const keyId = `${signer.accountId}:${signer.key.getPublicKey().toString()}`;
  const lease = await acquireSponsorKey(keyId);
  try {
    const leaseToken = randomUUID();
    const [owned] = await db.update(jobs).set({ leaseToken, leaseUntil: sql`now() + interval '180 seconds'` }).where(and(eq(jobs.id, job.id), eq(jobs.state, "approved"), lt(jobs.leaseUntil, sql`now()`), isNull(jobs.signedTransaction))).returning();
    if (!owned) return { claimId: job.id, state: "pending", txHash: job.transactionHash };
    // An unsigned expired intent has never been broadcast and can be refreshed.
    if (BigInt(request.deadline_ms) <= BigInt(Date.now())) {
      request.deadline_ms = String(Date.now() + 15 * 60_000);
      await db.update(jobs).set({ request }).where(and(eq(jobs.id, job.id), eq(jobs.leaseToken, leaseToken)));
    }
    const preview = await reader.previewExecute(job.actor, request);
    if (!preview.allowed) throw new Error("The reimbursement is outside the company's current permission or available budget");
    const access = await nearQuery({ request_type: "view_access_key", account_id: signer.accountId, public_key: signer.key.getPublicKey().toString() });
    if (access.permission !== "FullAccess") throw new Error("The reimbursement signing key must be registered on the configured NEAR account");
    const nonce = await allocateSponsorNonce(keyId, nextAccessKeyNonce(access.nonce).toString(), lease.leaseUntil);
    const args = { ...(scope.companyId ? { company_id: scope.companyId } : {}), request };
    const transaction = createTransaction(signer.accountId, signer.key.getPublicKey(), scope.contractId, BigInt(nonce), [functionCall("execute", args, 100_000_000_000_000n, 0n)], utils.serialize.base_decode(access.block_hash));
    const digest = createHash("sha256").update(transaction.encode()).digest();
    const signed = new SignedTransaction({ transaction, signature: new Signature({ keyType: signer.key.getPublicKey().keyType, data: signer.key.sign(digest).signature }) });
    const transactionHash = utils.serialize.base_encode(digest), signedTransaction = Buffer.from(signed.encode()).toString("base64");
    const saved = await db.update(jobs).set({ state: "submitted", transactionHash, signedTransaction }).where(and(eq(jobs.id, job.id), eq(jobs.leaseToken, leaseToken), eq(jobs.state, "approved"), isNull(jobs.signedTransaction))).returning();
    if (!saved.length) throw new Error("Payout reservation changed; no transaction was submitted");
    invalidateNearReadCache();
    try {
      const outcome = await rpc("send_tx", { signed_tx_base64: signedTransaction, wait_until: "FINAL" });
      if (outcome.status && "Failure" in outcome.status) {
        await db.update(jobs).set({ state: "failed" }).where(eq(jobs.id, job.id));
        return { claimId: job.id, state: "failed", txHash: transactionHash };
      }
    } catch { return { claimId: job.id, state: "pending", txHash: transactionHash }; }
    return reconcilePayout(saved[0]);
  } finally { await releaseSponsorKey(keyId, lease.leaseUntil); }
}
