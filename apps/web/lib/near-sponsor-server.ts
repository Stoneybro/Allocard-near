import { createHash, createPublicKey, verify } from "node:crypto";
import { KeyPair, utils } from "near-api-js";
import { Action, createTransaction, Signature, SignedTransaction, transfer } from "near-api-js/lib/transaction";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { parseTreasuryReference } from "@allocard/delegation-sdk";
import { requireEmployeeCompany, requireSessionUser } from "./auth-guard";
import { db } from "./db";
import { companies, delegations, users } from "./db/schema";
import { withRetry } from "./db/withRetry";
import { getSessionIdentity } from "./session";
import { nearQuery, treasuryReader, verifyTreasuryOwner, assertEmployeePermission } from "./near-server";
import { NearReadError } from "./near-read-error";
import { nearRpcServerUrl } from "./near-rpc-server";
import { nextAccessKeyNonce } from "./near-nonce";
import { canonicalSponsorJson, sponsoredDelegate, sponsoredSigningBytes, SPONSORED_VALID_BLOCKS, type SponsoredPayment, type SponsoredProof } from "./near-sponsored-action";
import { acquireSponsorKey, allocateSponsorNonce, claimSponsorJob, findSponsorJob, finishSponsorJob, releaseSponsorKey, releaseUnbroadcastJob, saveSponsorTransaction, takeSponsorQuota, type SponsorJob } from "./near-sponsor-store";
import { invalidateNearReadCache } from "./near-read-coordinator";

const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/).max(39);
const account = z.string().min(2).max(64).regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/);
const requestSchema = z.object({
  api_version: z.literal(1), request_id: z.string().regex(/^[0-9a-f]{64}$/), permission_id: decimal,
  action: z.object({ type: z.literal("Transfer"), asset: z.object({ type: z.literal("NativeNear") }).strict(), receiver: account, amount: decimal }).strict(),
  deadline_ms: decimal,
}).strict();
export const sponsoredPaymentSchema = z.object({ treasury: z.string().min(2).max(130), request: requestSchema }).strict();
export const sponsoredProofSchema = sponsoredPaymentSchema.extend({ nonce: decimal.max(20), maxBlockHeight: decimal.max(20), signature: z.string().regex(/^0x[0-9a-fA-F]{128}$/) });

function sponsorConfig() {
  const accountId = process.env.NEAR_RELAYER_ACCOUNT_ID;
  const secret = process.env.NEAR_RELAYER_PRIVATE_KEY;
  if (!accountId || !accountId.endsWith(".testnet") || !account.safeParse(accountId).success || !secret?.startsWith("ed25519:")) throw new Error("Configure a dedicated funded testnet NEAR relayer account and Ed25519 key on the server.");
  let key: KeyPair;
  try { key = KeyPair.fromString(secret as `ed25519:${string}`); } catch { throw new Error("The NEAR relayer key configuration is invalid."); }
  const bound = (value: string | undefined, fallback: number, max: number) => {
    if (!value) return fallback;
    const number = Number(value);
    if (!Number.isSafeInteger(number) || number < 1 || number > max) throw new Error("Invalid gas sponsorship quota configuration");
    return number;
  };
  return { accountId, key, globalLimit: bound(process.env.NEAR_SPONSOR_DAILY_LIMIT, 100, 1000), userLimit: bound(process.env.NEAR_SPONSOR_USER_DAILY_LIMIT, 10, 100) };
}
export function sponsorshipEnabled() { return process.env.NEAR_SPONSOR_ENABLED === "true"; }
const hash = (value: string | Uint8Array) => createHash("sha256").update(value).digest("hex");
export function paymentJobId(actor: string, payment: SponsoredPayment) {
  return hash(`execute\0${payment.treasury}\0${actor}\0${payment.request.request_id}`);
}
function paymentArgs(payment: SponsoredPayment) {
  const scope = parseTreasuryReference(payment.treasury);
  return { request: payment.request, ...(scope.companyId ? { company_id: scope.companyId } : {}) };
}

/** Only authenticated Privy employees with this exact active company permission qualify. */
async function authorizeEmployee(payment: SponsoredPayment) {
  const identity = await getSessionIdentity();
  if (!identity || !/^[0-9a-f]{64}$/.test(identity.walletAddress) || identity.providerUserId.startsWith("near:")) throw new Error("Sign in with your verified employee email wallet to use gas sponsorship.");
  const user = await requireSessionUser();
  if (user.privyUserId !== identity.providerUserId) throw new Error("Employee identity does not match the signing wallet");
  const [company] = await withRetry(() => db.select().from(companies).where(eq(companies.smartAccountAddress, payment.treasury)).limit(1), "sponsor:company");
  if (!company) throw new Error("Gas sponsorship is limited to registered Allocard treasuries");
  await requireEmployeeCompany(user.id, company.id);
  const [permission] = await withRetry(() => db.select().from(delegations).where(and(
    eq(delegations.delegatorType, "company"), eq(delegations.delegatorId, company.id),
    eq(delegations.delegateeType, "user"), eq(delegations.delegateeId, user.id),
    eq(delegations.status, "active"), eq(delegations.delegationHash, payment.request.permission_id),
    eq(delegations.treasuryReference, payment.treasury),
  )).limit(1), "sponsor:permission");
  if (!permission) throw new Error("An active company permission for this employee is required");
  return { identity, company };
}
async function previewPayment(actor: string, company: typeof companies.$inferSelect, payment: SponsoredPayment) {
  const [owner] = await withRetry(() => db.select().from(users).where(eq(users.id, company.ownerId)).limit(1), "sponsor:owner");
  if (!owner) throw new Error("Company owner not found");
  const config = await verifyTreasuryOwner(payment.treasury, owner.nearAccountId ?? owner.embeddedWalletAddress);
  const reader = treasuryReader(payment.treasury);
  assertEmployeePermission(await reader.getPermission(payment.request.permission_id), actor, config.owner, config.authority_epoch);
  const preview = await reader.previewExecute(actor, payment.request);
  if (!preview.allowed) throw new Error("This payment is outside the employee's current treasury permission.");
}

type RpcOutcome = { status: { SuccessValue?: string; Failure?: unknown }; transaction: { hash: string; signer_id: string; receiver_id: string; actions: unknown[] } };
async function relayRpc(method: string, params: object, txHash?: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(nearRpcServerUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: "allocard-sponsor", method, params }), signal: AbortSignal.timeout(method === "send_tx" || method === "tx" ? 40000 : 10000) });
    const payload = await response.json();
    if (!response.ok || payload.error || !payload.result) throw new Error("RPC rejected request");
    return payload.result;
  } catch {
    throw new Error(txHash ? `Sponsored transaction ${txHash} is not yet confirmed. Retry this same payment to check its status; it will not be submitted again.` : "The gas sponsor could not reach NEAR testnet. Retry shortly.");
  }
}
async function assertTestnet() {
  const status = await relayRpc("status", {});
  if (status.chain_id !== "testnet") throw new Error("Gas sponsorship is only enabled for NEAR testnet");
}
function assertOutcome(result: Record<string, unknown>, transactionHash: string): RpcOutcome {
  const outcome = result as unknown as RpcOutcome;
  if (!outcome.transaction || outcome.transaction.hash !== transactionHash || (!outcome.status || typeof outcome.status !== "object" || !("SuccessValue" in outcome.status))) {
    throw new Error(`Sponsored transaction ${transactionHash} did not succeed. Check its execution before starting a new payment.`);
  }
  return outcome;
}
async function recover(job: SponsorJob, intentHash: string) {
  if (job.intentHash !== intentHash) throw new Error("This payment request ID was already used for different payment details");
  if (!job.transactionHash) throw new Error("This sponsorship attempt is reserved but has no transaction reference. Contact the operator before starting a new payment.");
  const result = await relayRpc("tx", { tx_hash: job.transactionHash, sender_account_id: job.relayerId, wait_until: "FINAL" }, job.transactionHash);
  return assertOutcome(result, job.transactionHash);
}

async function submitOuter(id: string, actor: string, intentHash: string, receiverId: string, actions: Action[]) {
  const config = sponsorConfig();
  const existing = await findSponsorJob(id);
  if (existing) return recover(existing, intentHash);
  const keyId = `${config.accountId}:${config.key.getPublicKey().toString()}`;
  // Take the cross-instance key lease before claiming the job so a busy sponsor
  // does not strand a payment intent. Different requests never race nonces.
  const lease = await acquireSponsorKey(keyId);
  let ownsJob = false;
  try {
    const claimed = await claimSponsorJob({ id, actor, intentHash, relayerId: config.accountId });
    if (!claimed) {
      const job = await findSponsorJob(id);
      if (!job) throw new Error("Sponsorship reservation could not be confirmed");
      return recover(job, intentHash);
    }
    ownsJob = true;
    await takeSponsorQuota(actor, config.globalLimit, config.userLimit);
    const gasPrice = await relayRpc("gas_price", [null]);
    if (typeof gasPrice.gas_price !== "string" || BigInt(gasPrice.gas_price) > 1_000_000_000n) throw new Error("Gas price exceeds the sponsor's configured safety ceiling");
    const access = await nearQuery({ request_type: "view_access_key", account_id: config.accountId, public_key: config.key.getPublicKey().toString() });
    if (access.permission !== "FullAccess" || typeof access.block_hash !== "string") throw new Error("The dedicated relayer requires a registered regular FullAccess key");
    const nonce = await allocateSponsorNonce(keyId, nextAccessKeyNonce(access.nonce).toString(), lease.leaseUntil);
    const transaction = createTransaction(config.accountId, config.key.getPublicKey(), receiverId, BigInt(nonce), actions, utils.serialize.base_decode(access.block_hash));
    const digest = createHash("sha256").update(transaction.encode()).digest();
    const signature = config.key.sign(digest);
    const signed = new SignedTransaction({ transaction, signature: new Signature({ keyType: config.key.getPublicKey().keyType, data: signature.signature }) });
    const transactionHash = utils.serialize.base_encode(digest);
    const serialized = Buffer.from(signed.encode()).toString("base64");
    // Never broadcast before the exact signed transaction and hash are durable.
    await saveSponsorTransaction(id, transactionHash, serialized);
    invalidateNearReadCache();
    const result = await relayRpc("send_tx", { signed_tx_base64: serialized, wait_until: "FINAL" }, transactionHash);
    const status = result.status;
    if (status && typeof status === "object" && ("Failure" in status || "SuccessValue" in status)) {
      await finishSponsorJob(id, "Failure" in status ? "failed" : "confirmed");
    }
    return assertOutcome(result, transactionHash);
  } catch (caught) {
    // A failed preflight is retryable. Once a transaction hash is stored, retain
    // the journal even on timeouts, and only ever reconcile that transaction.
    if (ownsJob) await releaseUnbroadcastJob(id);
    throw caught;
  } finally {
    await releaseSponsorKey(keyId, lease.leaseUntil);
  }
}

async function ensureEmployeeAccount(actor: string) {
  try { await nearQuery({ request_type: "view_account", account_id: actor }); }
  catch (caught) {
    if (!(caught instanceof NearReadError) || caught.code !== "UNKNOWN_ACCOUNT") throw caught;
    // One zero-value transfer creates the implicit account and its regular key.
    // The relayer pays creation gas; it never transfers spendable principal.
    await submitOuter(hash(`activate\0${actor}`), actor, hash(`activate\0${actor}`), actor, [transfer(0n)]);
  }
  const publicKey = utils.PublicKey.fromString(`ed25519:${utils.serialize.base_encode(Buffer.from(actor, "hex"))}`);
  const access = await nearQuery({ request_type: "view_access_key", account_id: actor, public_key: publicKey.toString() });
  if (access.permission !== "FullAccess") throw new Error("The employee wallet needs its original regular FullAccess key. Sponsorship cannot replace a removed key.");
  return access;
}

export async function prepareSponsoredPayment(payment: SponsoredPayment) {
  sponsorConfig();
  const { identity, company } = await authorizeEmployee(payment);
  await assertTestnet();
  const intentHash = hash(canonicalSponsorJson(payment));
  const existing = await findSponsorJob(paymentJobId(identity.walletAddress, payment));
  if (existing) return { enabled: true, outcome: await recover(existing, intentHash) };
  await previewPayment(identity.walletAddress, company, payment);
  const access = await ensureEmployeeAccount(identity.walletAddress);
  if (!Number.isSafeInteger(access.block_height)) throw new Error("NEAR returned an invalid block height");
  return { enabled: true, nonce: nextAccessKeyNonce(access.nonce).toString(), maxBlockHeight: String(access.block_height + SPONSORED_VALID_BLOCKS) };
}

export async function submitSponsoredPayment(proof: SponsoredProof) {
  const payment = sponsoredPaymentSchema.parse({ treasury: proof.treasury, request: proof.request });
  const { identity, company } = await authorizeEmployee(payment);
  await assertTestnet();
  const id = paymentJobId(identity.walletAddress, payment);
  const intentHash = hash(canonicalSponsorJson(payment));
  const existing = await findSponsorJob(id);
  if (existing) return { enabled: true, outcome: await recover(existing, intentHash) };
  const scope = parseTreasuryReference(payment.treasury);
  const delegate = sponsoredDelegate(identity.walletAddress, scope.contractId, paymentArgs(payment), proof.nonce, proof.maxBlockHeight);
  const digest = createHash("sha256").update(sponsoredSigningBytes(delegate)).digest();
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(identity.walletAddress, "hex")]), format: "der", type: "spki" });
  if (!verify(null, digest, publicKey, Buffer.from(proof.signature.slice(2), "hex"))) throw new Error("Invalid employee meta-transaction signature");
  const access = await nearQuery({ request_type: "view_access_key", account_id: identity.walletAddress, public_key: delegate.publicKey.toString() });
  if (access.permission !== "FullAccess" || delegate.nonce !== nextAccessKeyNonce(access.nonce)) throw new Error("The employee signing nonce changed. Retry this payment with a fresh signature.");
  if (!Number.isSafeInteger(access.block_height) || delegate.maxBlockHeight <= BigInt(access.block_height) || delegate.maxBlockHeight > BigInt(access.block_height + SPONSORED_VALID_BLOCKS)) throw new Error("The employee meta-transaction expired or has an excessive validity window");
  await previewPayment(identity.walletAddress, company, payment);
  const action = new Action({ signedDelegate: { delegateAction: delegate, signature: new Signature({ keyType: delegate.publicKey.keyType, data: Buffer.from(proof.signature.slice(2), "hex") }) } });
  return { enabled: true, outcome: await submitOuter(id, identity.walletAddress, intentHash, identity.walletAddress, [action]) };
}
