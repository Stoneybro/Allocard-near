import "server-only";
import { createHash, createPublicKey, verify } from "node:crypto";
import { Action, Signature } from "near-api-js/lib/transaction";
import { and, eq, sql } from "drizzle-orm";
import { decodeMutationId, type PermissionSpec } from "@allocard/delegation-sdk";
import { db } from "./db";
import { companies, companyMemberships, delegations, users } from "./db/schema";
import { requireSessionUser } from "./auth-guard";
import { getSessionIdentity } from "./session";
import { sponsoredRootSchema, sponsoredRootProofSchema } from "./adapter-permission-schema";
import { canonicalSponsorJson, sponsoredRootDelegate, sponsoredSigningBytes, SPONSORED_VALID_BLOCKS, type SponsoredRootPermission, type SponsoredRootProof } from "./near-sponsored-action";
import { assertTestnet, ensureSigningAccount, relayRpc, sponsorConfig, submitOuter, type RpcOutcome } from "./near-sponsor-server";
import { findSponsorJob, releaseFailedRootPermissionJob, type SponsorJob } from "./near-sponsor-store";
import { nearQuery, treasuryReader, verifyTreasuryOwner } from "./near-server";
import { nextAccessKeyNonce } from "./near-nonce";
import { SPENDING_ASSET, sameAsset } from "./chain";
import { validatePermissionSpec } from "./policy-engine";
import { TransactionNotSubmittedError } from "./payment-submission";

export class RootPermissionFailedError extends Error {}

const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
const jobId = (actor: string, input: SponsoredRootPermission) => hash(`root_permission\0${input.treasury}\0${actor}\0${input.delegationId}`);

async function authorize(input: SponsoredRootPermission) {
  sponsorConfig();
  const identity = await getSessionIdentity();
  const user = await requireSessionUser();
  if (!identity || !/^[0-9a-f]{64}$/.test(identity.walletAddress) || user.privyUserId !== identity.providerUserId || identity.providerUserId.startsWith("near:")) throw new Error("Verified employer wallet required");
  const [company] = await db.select().from(companies).where(and(eq(companies.smartAccountAddress, input.treasury), eq(companies.ownerId, user.id))).limit(1);
  if (!company) throw new Error("Only the company owner can sponsor this employee allowance");
  const [[membership], [grant]] = await Promise.all([
    db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, company.id), eq(companyMemberships.userId, user.id), eq(companyMemberships.canEmployer, true), eq(companyMemberships.status, "active"))).limit(1),
    db.select().from(delegations).where(eq(delegations.id, input.delegationId)).limit(1),
  ]);
  if (!membership || !grant || grant.delegatorType !== "company" || grant.delegatorId !== company.id || grant.delegateeType !== "user" || !grant.delegateeId || !["pending_config", "active"].includes(grant.status)) throw new Error("A pending employee allowance in your own company is required");
  const [employee] = await db.select({ account: sql<string>`COALESCE(${users.nearAccountId}, ${users.embeddedWalletAddress})` }).from(companyMemberships)
    .innerJoin(users, eq(companyMemberships.userId, users.id))
    .where(and(eq(companyMemberships.companyId, company.id), eq(companyMemberships.userId, grant.delegateeId), eq(companyMemberships.canEmployee, true), eq(companyMemberships.status, "active"))).limit(1);
  if (!employee || employee.account !== input.spec.delegate) throw new Error("The allowance must target this company's accepted employee");
  return { identity, grant };
}

async function preview(actor: string, input: SponsoredRootPermission) {
  const validation = validatePermissionSpec(input.spec);
  const rule = input.spec.rules[0];
  if (!validation.valid || !sameAsset(rule.asset, SPENDING_ASSET) || !rule.lifetime_limit || BigInt(rule.lifetime_limit) <= 0n || rule.approval || rule.streaming || rule.min_per_action) throw new Error("A supported finite employee spending policy is required");
  const now = BigInt(Date.now());
  if (input.spec.expires_at_ms && BigInt(input.spec.expires_at_ms) <= now) throw new Error("The employee policy has expired");
  const reader = treasuryReader(input.treasury);
  const [config, budget, ledger, blocked] = await Promise.all([
    verifyTreasuryOwner(input.treasury, actor), reader.getTreasuryBudget(SPENDING_ASSET), reader.getAssetLedger(SPENDING_ASSET),
    Promise.all([actor, input.spec.delegate].map(account => reader.caller.viewFunction({ contractId: reader.contractId, methodName: "is_principal_blocked", args: { account } }))),
  ]);
  if (config.schema_version < (reader.companyId ? 5 : 4) || config.paused || !ledger?.enabled || blocked.some(Boolean)) throw new Error("The treasury or employee is not available for a new allowance");
  if (BigInt(rule.lifetime_limit) > BigInt(budget.unallocated)) throw new Error("The allowance exceeds unallocated company funds");
}

function terms(spec: PermissionSpec) {
  return { delegate: spec.delegate, valid_from_ms: spec.valid_from_ms, expires_at_ms: spec.expires_at_ms ?? null,
    max_executions: spec.max_executions ?? null, redelegation_depth: spec.redelegation_depth, metadata_hash: spec.metadata_hash ?? null,
    rules: spec.rules.map(rule => ({ asset: rule.asset, recipients: rule.recipients, min_per_action: rule.min_per_action ?? null, max_per_action: rule.max_per_action ?? null,
      lifetime_limit: rule.lifetime_limit ?? null, fixed_window: rule.fixed_window ?? null, streaming: rule.streaming ?? null, approval: rule.approval ?? null, acknowledge_unbounded_budget: rule.acknowledge_unbounded_budget })),
  };
}
async function result(outcome: RpcOutcome, input: SponsoredRootPermission, actor: string) {
  const reader = treasuryReader(input.treasury);
  const receipts = (outcome as RpcOutcome & { receipts_outcome?: Array<{ outcome: { executor_id: string; status: { SuccessValue?: string; Failure?: unknown } } }> }).receipts_outcome ?? [];
  const ids = new Set<string>();
  for (const receipt of receipts.filter(value => value.outcome.executor_id === reader.contractId)) {
    if (receipt.outcome.status.Failure !== undefined) {
      await releaseFailedRootPermissionJob(jobId(actor, input), outcome.transaction.hash);
      throw new RootPermissionFailedError(`Allowance transaction ${outcome.transaction.hash} failed. No allowance was created. Review the policy and retry.`);
    }
    if (receipt.outcome.status.SuccessValue) ids.add(decodeMutationId({ status: receipt.outcome.status }));
  }
  if (outcome.status.SuccessValue) ids.add(decodeMutationId(outcome));
  if (ids.size !== 1) throw new Error("The allowance transaction is confirmed but its permission ID is unavailable. Retry the same policy to recover it.");
  const [id] = ids;
  const permission = await reader.getPermission(id);
  if (!permission || permission.revoked || permission.issuer !== actor || permission.parent_id != null || canonicalSponsorJson(terms(permission)) !== canonicalSponsorJson(terms(input.spec))) throw new Error("The confirmed employee allowance does not match the signed policy");
  return { ...outcome, rootPermissionId: id, permission };
}

async function recoverRoot(job: SponsorJob, intentHash: string, input: SponsoredRootPermission, actor: string) {
  if (job.intentHash !== intentHash || !job.transactionHash) throw new Error("Restore the original employee policy to recover its saved transaction.");
  const raw = await relayRpc("tx", { tx_hash: job.transactionHash, sender_account_id: job.relayerId, wait_until: "FINAL" }, job.transactionHash) as RpcOutcome;
  if (raw.transaction?.hash !== job.transactionHash) throw new Error("The original allowance transaction could not be verified. No replacement was submitted.");
  return result(raw, input, actor);
}

export async function prepareSponsoredRoot(input: SponsoredRootPermission) {
  const permission = sponsoredRootSchema.parse(input);
  const { identity, grant } = await authorize(permission);
  const intentHash = hash(canonicalSponsorJson(permission));
  const existing = await findSponsorJob(jobId(identity.walletAddress, permission));
  if (existing) { await assertTestnet(); return { enabled: true, outcome: await recoverRoot(existing, intentHash, permission, identity.walletAddress) }; }
  try {
    if (grant.status !== "pending_config") throw new Error("This employee allowance is already active");
    await Promise.all([assertTestnet(), preview(identity.walletAddress, permission)]);
    const access = await ensureSigningAccount(identity.walletAddress);
    if (!Number.isSafeInteger(access.block_height)) throw new Error("Invalid NEAR block height");
    return { enabled: true, nonce: nextAccessKeyNonce(access.nonce).toString(), maxBlockHeight: String(access.block_height + SPONSORED_VALID_BLOCKS) };
  } catch (error) { throw new TransactionNotSubmittedError(error instanceof Error ? error.message : "Allowance validation failed before submission"); }
}

export async function submitSponsoredRoot(input: SponsoredRootProof) {
  const { nonce, maxBlockHeight, signature, ...permission } = sponsoredRootProofSchema.parse(input);
  const { identity, grant } = await authorize(permission);
  const id = jobId(identity.walletAddress, permission), intentHash = hash(canonicalSponsorJson(permission));
  const existing = await findSponsorJob(id);
  if (existing) { await assertTestnet(); return { enabled: true, outcome: await recoverRoot(existing, intentHash, permission, identity.walletAddress) }; }
  const delegate = sponsoredRootDelegate(identity.walletAddress, permission, nonce, maxBlockHeight);
  try {
    if (grant.status !== "pending_config") throw new Error("This employee allowance is already active");
    const digest = createHash("sha256").update(sponsoredSigningBytes(delegate)).digest();
    const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(identity.walletAddress, "hex")]), format: "der", type: "spki" });
    if (!verify(null, digest, key, Buffer.from(signature.slice(2), "hex"))) throw new Error("Invalid employer allowance signature");
    const [access] = await Promise.all([
      nearQuery({ request_type: "view_access_key", account_id: identity.walletAddress, public_key: delegate.publicKey.toString() }),
      assertTestnet(), preview(identity.walletAddress, permission),
    ]);
    if (access.permission !== "FullAccess" || delegate.nonce !== nextAccessKeyNonce(access.nonce) || !Number.isSafeInteger(access.block_height) || delegate.maxBlockHeight <= BigInt(access.block_height) || delegate.maxBlockHeight > BigInt(access.block_height + SPONSORED_VALID_BLOCKS)) throw new Error("The employer signature nonce or expiry changed. Retry the same policy.");
  } catch (error) { throw new TransactionNotSubmittedError(error instanceof Error ? error.message : "Allowance validation failed before submission"); }
  const action = new Action({ signedDelegate: { delegateAction: delegate, signature: new Signature({ keyType: delegate.publicKey.keyType, data: Buffer.from(signature.slice(2), "hex") }) } });
  let outcome;
  try { outcome = await submitOuter(id, identity.walletAddress, intentHash, identity.walletAddress, [action]); }
  catch (error) {
    const journal = await findSponsorJob(id);
    if (journal?.transactionHash) return { enabled: true, outcome: await recoverRoot(journal, intentHash, permission, identity.walletAddress) };
    throw error;
  }
  return { enabled: true, outcome: await result(outcome, permission, identity.walletAddress) };
}
