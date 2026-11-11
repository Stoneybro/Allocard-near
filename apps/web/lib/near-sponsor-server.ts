import { ACTIVATION_USDC, FAUCET_USDC, MOCK_USDC_ACCOUNT_ID, SPENDING_ASSET, SPENDING_DECIMALS, sameAsset } from "./chain";
import { spendingAssetSchema } from "./spending-asset-schema";
import { createHash, createPublicKey, verify } from "node:crypto";
import { KeyPair, utils } from "near-api-js";
import { Action, createTransaction, Signature, SignedTransaction, functionCall, transfer } from "near-api-js/lib/transaction";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { computeCompanyId, decodeMutationId, parseTokenAmount, parseTreasuryReference, treasuryReference } from "@allocard/delegation-sdk";
import { requireEmployeeCompany, requireSessionUser } from "./auth-guard";
import { db } from "./db";
import { agents, companies, companyMemberships, delegations, users } from "./db/schema";
import { adapterAccount } from "./agent-adapter/config";
import { ADAPTER_NAME } from "./agent-adapter/shared";
import { sponsoredAdapterSchema, sponsoredAdapterProofSchema } from "./adapter-permission-schema";
import { sponsoredAdapterDelegate } from "./near-sponsored-action";
import { withRetry } from "./db/withRetry";
import { getSessionIdentity } from "./session";
import { nearQuery, treasuryReader, verifyTreasuryOwner, assertEmployeePermission } from "./near-server";
import { verifiedSharedConfig } from "./shared-server";
import { NearReadError } from "./near-read-error";
import { nearRpcServerUrl } from "./near-rpc-server";
import { nextAccessKeyNonce } from "./near-nonce";
import { MAX_SPONSORED_COMPANY_DEPOSIT, canonicalSponsorJson, sponsoredCompanyDelegate, sponsoredDelegate, sponsoredSigningBytes, SPONSORED_VALID_BLOCKS, type SponsoredCompany, type SponsoredCompanyProof, type SponsoredPayment, type SponsoredProof } from "./near-sponsored-action";
import { acquireSponsorKey, allocateSponsorNonce, claimSponsorJob, findSponsorJob, finishSponsorJob, releaseSponsorKey, releaseUnbroadcastJob, saveSponsorTransaction, type SponsorJob } from "./near-sponsor-store";
import { invalidateNearReadCache } from "./near-read-coordinator";
import { NearRpcError, describeNearRpcError } from "./near-rpc-error";
import { releaseRejectedSponsorJob, releaseUncreditedFaucetJob } from "./near-sponsor-store";
import { TransactionNotSubmittedError } from "./payment-submission";

const decimal = z.string().regex(/^(0|[1-9][0-9]*)$/).max(39);
const account = z.string().min(2).max(64).regex(/^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/);
const requestSchema = z.object({
  api_version: z.literal(1), request_id: z.string().regex(/^[0-9a-f]{64}$/), permission_id: decimal,
  action: z.object({ type: z.literal("Transfer"), asset: spendingAssetSchema, receiver: account, amount: decimal }).strict(),
  deadline_ms: decimal,
}).strict();
export const sponsoredPaymentSchema = z.object({ treasury: z.string().min(2).max(130), request: requestSchema }).strict();
export const sponsoredProofSchema = sponsoredPaymentSchema.extend({ nonce: decimal.max(20), maxBlockHeight: decimal.max(20), signature: z.string().regex(/^0x[0-9a-fA-F]{128}$/) });

export const sponsoredCompanySchema = z.object({ companyKey: z.uuid(), contractId: account, deposit: decimal }).strict();
export const sponsoredCompanyProofSchema = sponsoredCompanySchema.extend({ nonce: decimal.max(20), maxBlockHeight: decimal.max(20), signature: z.string().regex(/^0x[0-9a-fA-F]{128}$/) });
export function companySponsorshipEnabled() { return sponsorshipEnabled() && process.env.NEAR_SPONSOR_COMPANY_ENABLED === "true"; }

function sponsorConfig() {
  const accountId = process.env.NEAR_RELAYER_ACCOUNT_ID;
  const secret = process.env.NEAR_RELAYER_PRIVATE_KEY;
  if (!accountId || !accountId.endsWith(".testnet") || !account.safeParse(accountId).success) throw new Error("NEAR_RELAYER_ACCOUNT_ID must be a valid .testnet account ID on the server.");
  if (!secret) throw new Error("NEAR_RELAYER_PRIVATE_KEY is empty or missing on the server. Remove duplicate blank entries in apps/web/.env.local and restart the web server.");
  if (!secret.startsWith("ed25519:")) throw new Error("NEAR_RELAYER_PRIVATE_KEY must be an Ed25519 secret starting with ed25519:.");
  let key: KeyPair;
  try { key = KeyPair.fromString(secret as `ed25519:${string}`); } catch { throw new Error("The NEAR relayer key configuration is invalid."); }
  return { accountId, key };
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
    if (payload.error?.cause) {
      const detail = describeNearRpcError(payload.error);
      throw new NearRpcError(detail.message, detail.rpcCause, detail.invalidReason);
    }
    if (!response.ok || payload.error || !payload.result) throw new Error("RPC rejected request");
    return payload.result;
  } catch (caught) {
    if (caught instanceof NearRpcError && caught.rpcCause === "INVALID_TRANSACTION") throw caught;
    throw new Error(txHash ? `Sponsored transaction ${txHash} is not yet confirmed. Retry this same action to check its status; it will not be submitted again.` : "The gas sponsor could not reach NEAR testnet. Retry shortly.");
  }
}
async function assertTestnet() {
  const status = await relayRpc("status", {});
  if (status.chain_id !== "testnet") throw new Error("Gas sponsorship is only enabled for NEAR testnet");
}
function assertOutcome(result: Record<string, unknown>, transactionHash: string): RpcOutcome {
  const outcome = result as unknown as RpcOutcome;
  if (!outcome.transaction || outcome.transaction.hash !== transactionHash || (!outcome.status || typeof outcome.status !== "object" || !("SuccessValue" in outcome.status))) {
    throw new Error(`Sponsored transaction ${transactionHash} did not succeed. Check its execution before starting a new attempt.`);
  }
  return outcome;
}
async function recover(job: SponsorJob, intentHash: string) {
  if (job.intentHash !== intentHash) throw new Error("This payment request ID was already used for different payment details");
  if (!job.transactionHash) throw new Error("This sponsorship attempt is reserved but has no transaction reference. Contact the operator before starting a new attempt.");
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
  let broadcastHash: string | undefined;
  try {
    const claimed = await claimSponsorJob({ id, actor, intentHash, relayerId: config.accountId });
    if (!claimed) {
      const job = await findSponsorJob(id);
      if (!job) throw new Error("Sponsorship reservation could not be confirmed");
      return recover(job, intentHash);
    }
    ownsJob = true;
    const gasPrice = await relayRpc("gas_price", [null]);
    if (typeof gasPrice.gas_price !== "string" || BigInt(gasPrice.gas_price) > 1_000_000_000n) throw new Error("Gas price exceeds the sponsor's configured safety ceiling");
    const [access, relayerAccount] = await Promise.all([
      nearQuery({ request_type: "view_access_key", account_id: config.accountId, public_key: config.key.getPublicKey().toString() }),
      nearQuery({ request_type: "view_account", account_id: config.accountId }),
    ]).catch(caught => {
      if (caught instanceof NearReadError && caught.code === "UNKNOWN_ACCESS_KEY") throw new Error(`The configured relayer signing key is not registered on ${config.accountId}. Set NEAR_RELAYER_PRIVATE_KEY to a registered regular FullAccess key for that account.`);
      if (caught instanceof NearReadError && caught.code === "UNKNOWN_ACCOUNT") throw new Error(`The relayer account ${config.accountId} does not exist on NEAR testnet.`);
      throw caught;
    });
    const innerActions = actions.flatMap(action => action.signedDelegate?.delegateAction.actions ?? [action]);
    const attachedDeposit = innerActions.reduce((total, action) => total + (action.functionCall?.deposit ?? action.transfer?.deposit ?? 0n), 0n);
    const storageBytes = relayerAccount.storage_usage;
    if (typeof relayerAccount.amount !== "string" || !/^[0-9]+$/.test(relayerAccount.amount) || !Number.isSafeInteger(storageBytes) || storageBytes < 0) throw new Error("Could not verify the relayer's available balance");
    // Verify that the relayer can pay the transaction deposit, gas, and account storage.
    const requiredBalance = attachedDeposit + 200000000000000n * BigInt(gasPrice.gas_price) + BigInt(storageBytes) * 10000000000000000000n;
    if (BigInt(relayerAccount.amount) < requiredBalance) throw new Error("Fund the relayer account before retrying: its balance cannot cover sponsorship gas, storage and the required attached deposit");
    if (access.permission !== "FullAccess" || typeof access.block_hash !== "string") throw new Error("The dedicated relayer requires a registered regular FullAccess key");
    const nonce = await allocateSponsorNonce(keyId, nextAccessKeyNonce(access.nonce).toString(), lease.leaseUntil);
    const transaction = createTransaction(config.accountId, config.key.getPublicKey(), receiverId, BigInt(nonce), actions, utils.serialize.base_decode(access.block_hash));
    const digest = createHash("sha256").update(transaction.encode()).digest();
    const signature = config.key.sign(digest);
    const signed = new SignedTransaction({ transaction, signature: new Signature({ keyType: config.key.getPublicKey().keyType, data: signature.signature }) });
    const transactionHash = utils.serialize.base_encode(digest);
    broadcastHash = transactionHash;
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
    if (ownsJob && broadcastHash && caught instanceof NearRpcError && caught.rpcCause === "INVALID_TRANSACTION") await releaseRejectedSponsorJob(id, broadcastHash);
    else if (ownsJob) await releaseUnbroadcastJob(id);
    if (ownsJob && !broadcastHash) throw new TransactionNotSubmittedError(caught instanceof Error ? caught.message : "Sponsorship validation failed before submission");
    throw caught;
  } finally {
    await releaseSponsorKey(keyId, lease.leaseUntil);
  }
}

async function ensureSigningAccount(actor: string) {
  try { await nearQuery({ request_type: "view_account", account_id: actor }); }
  catch (caught) {
    if (!(caught instanceof NearReadError) || caught.code !== "UNKNOWN_ACCOUNT") throw caught;
    // One zero-value transfer creates the implicit account and its regular key.
    // The relayer pays creation gas; it never transfers spendable principal.
    await submitOuter(hash(`activate\0${actor}`), actor, hash(`activate\0${actor}`), actor, [transfer(0n)]);
  }
  const publicKey = utils.PublicKey.fromString(`ed25519:${utils.serialize.base_encode(Buffer.from(actor, "hex"))}`);
  const access = await nearQuery({ request_type: "view_access_key", account_id: actor, public_key: publicKey.toString() });
  if (access.permission !== "FullAccess") throw new Error("This wallet needs its original regular FullAccess key. Sponsorship cannot replace a removed key.");
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
  const access = await ensureSigningAccount(identity.walletAddress);
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
  if (payment.request.action.asset.type === "Nep141") {
    await registerSpendingTokenReceiver(identity.walletAddress, payment.request.action.receiver);
  }
  const action = new Action({ signedDelegate: { delegateAction: delegate, signature: new Signature({ keyType: delegate.publicKey.keyType, data: Buffer.from(proof.signature.slice(2), "hex") }) } });
  return { enabled: true, outcome: await submitOuter(id, identity.walletAddress, intentHash, identity.walletAddress, [action]) };
}


async function authorizeCompanyOwner(company: SponsoredCompany) {
  if (!companySponsorshipEnabled()) throw new Error("Company registration sponsorship is not enabled");
  const identity = await getSessionIdentity();
  if (!identity || !/^[0-9a-f]{64}$/.test(identity.walletAddress) || identity.providerUserId.startsWith("near:")) throw new Error("Sign in with your verified owner email wallet to sponsor company registration");
  const user = await requireSessionUser();
  if (user.privyUserId !== identity.providerUserId) throw new Error("Company owner identity does not match the signing wallet");
  const [workspace] = await withRetry(() => db.select().from(companies).where(and(eq(companies.id, company.companyKey), eq(companies.ownerId, user.id))).limit(1), "sponsor:owner-workspace");
  if (!workspace || workspace.ownerId !== user.id) throw new Error("Only this workspace's owner can sponsor company registration");
  const [membership] = await withRetry(() => db.select().from(companyMemberships).where(and(
    eq(companyMemberships.companyId, workspace.id), eq(companyMemberships.userId, user.id),
    eq(companyMemberships.canEmployer, true), eq(companyMemberships.status, "active"),
  )).limit(1), "sponsor:owner-membership");
  if (!membership) throw new Error("Active employer membership is required to sponsor company registration");
  const config = await verifiedSharedConfig();
  if (company.contractId !== config.contractId || company.deposit !== config.creation_deposit || BigInt(company.deposit) > BigInt(MAX_SPONSORED_COMPANY_DEPOSIT)) throw new Error("Company sponsorship must use the verified shared contract and its exact registration deposit, up to 0.2 NEAR");
  const id = computeCompanyId(identity.walletAddress, company.companyKey);
  if (workspace.smartAccountAddress && workspace.smartAccountAddress !== treasuryReference(company.contractId, id)) throw new Error("This workspace already uses a different treasury");
  return { identity, companyId: id };
}
function companyJobId(actor: string, company: SponsoredCompany) {
  return hash(`create_company\0${company.contractId}\0${actor}\0${company.companyKey}`);
}
async function companyRegistered(company: SponsoredCompany, companyId: string): Promise<boolean> {
  const result = await nearQuery({ request_type: "call_function", account_id: company.contractId, method_name: "company_exists", args_base64: Buffer.from(JSON.stringify({ company_id: companyId })).toString("base64") });
  const exists = JSON.parse(Buffer.from(result.result).toString("utf8"));
  if (typeof exists !== "boolean") throw new Error("Could not verify company registration state");
  return exists;
}
export async function prepareSponsoredCompany(company: SponsoredCompany) {
  sponsorConfig();
  const { identity, companyId } = await authorizeCompanyOwner(company);
  await assertTestnet();
  if (await companyRegistered(company, companyId)) return { enabled: true, registered: true };
  const intentHash = hash(canonicalSponsorJson(company));
  const existing = await findSponsorJob(companyJobId(identity.walletAddress, company));
  if (existing) return { enabled: true, outcome: await recover(existing, intentHash) };
  const access = await ensureSigningAccount(identity.walletAddress);
  if (!Number.isSafeInteger(access.block_height)) throw new Error("NEAR returned an invalid block height");
  return { enabled: true, nonce: nextAccessKeyNonce(access.nonce).toString(), maxBlockHeight: String(access.block_height + SPONSORED_VALID_BLOCKS) };
}
export async function submitSponsoredCompany(proof: SponsoredCompanyProof) {
  const company = sponsoredCompanySchema.parse({ companyKey: proof.companyKey, contractId: proof.contractId, deposit: proof.deposit });
  const { identity, companyId } = await authorizeCompanyOwner(company);
  await assertTestnet();
  if (await companyRegistered(company, companyId)) return { enabled: true, registered: true };
  const intentHash = hash(canonicalSponsorJson(company));
  const id = companyJobId(identity.walletAddress, company);
  const existing = await findSponsorJob(id);
  if (existing) return { enabled: true, outcome: await recover(existing, intentHash) };
  const delegate = sponsoredCompanyDelegate(identity.walletAddress, company, proof.nonce, proof.maxBlockHeight);
  const digest = createHash("sha256").update(sponsoredSigningBytes(delegate)).digest();
  const publicKey = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(identity.walletAddress, "hex")]), format: "der", type: "spki" });
  if (!verify(null, digest, publicKey, Buffer.from(proof.signature.slice(2), "hex"))) throw new Error("Invalid company owner meta-transaction signature");
  const access = await nearQuery({ request_type: "view_access_key", account_id: identity.walletAddress, public_key: delegate.publicKey.toString() });
  if (access.permission !== "FullAccess" || delegate.nonce !== nextAccessKeyNonce(access.nonce)) throw new Error("The owner signing nonce changed. Retry company registration with a fresh signature.");
  if (!Number.isSafeInteger(access.block_height) || delegate.maxBlockHeight <= BigInt(access.block_height) || delegate.maxBlockHeight > BigInt(access.block_height + SPONSORED_VALID_BLOCKS)) throw new Error("The owner meta-transaction expired or has an excessive validity window");
  const action = new Action({ signedDelegate: { delegateAction: delegate, signature: new Signature({ keyType: delegate.publicKey.keyType, data: Buffer.from(proof.signature.slice(2), "hex") }) } });
  return { enabled: true, outcome: await submitOuter(id, identity.walletAddress, intentHash, identity.walletAddress, [action]) };
}

/** Only the owned adapter's employee child permission can use this subsidy. */
async function authorizeAdapterPermission(permission: import("./near-sponsored-action").SponsoredAdapterPermission) {
  const identity = await getSessionIdentity();
  if (!identity || !/^[0-9a-f]{64}$/.test(identity.walletAddress) || identity.providerUserId.startsWith("near:")) throw new Error("Verified employee wallet required");
  const user = await requireSessionUser();
  if (user.privyUserId !== identity.providerUserId) throw new Error("Employee identity mismatch");
  const [company] = await db.select().from(companies).where(eq(companies.smartAccountAddress, permission.treasury)).limit(1);
  if (!company) throw new Error("Registered company treasury required");
  await requireEmployeeCompany(user.id, company.id);
  const [child] = await db.select().from(delegations).where(eq(delegations.id, permission.delegationId)).limit(1);
  if (!child || child.delegatorType !== "user" || child.delegatorId !== user.id || child.delegateeType !== "agent" || !["pending_config", "active"].includes(child.status) || !child.parentDelegationId) throw new Error("Only your adapter permission can be sponsored");
  const [parent] = await db.select().from(delegations).where(eq(delegations.id, child.parentDelegationId)).limit(1);
  if (!parent || parent.delegatorType !== "company" || parent.delegatorId !== company.id || parent.delegateeType !== "user" || parent.delegateeId !== user.id || parent.status !== "active" || parent.delegationHash !== permission.parentId || parent.treasuryReference !== permission.treasury) throw new Error("Permission belongs to another employee, parent or company");
  const [agent] = await db.select().from(agents).where(eq(agents.id, child.delegateeId!)).limit(1);
  const adapter = adapterAccount();
  if (!adapter || !agent?.isActive || agent.name !== ADAPTER_NAME || agent.smartAccountAddress !== adapter || agent.signerAddress !== adapter || permission.spec.delegate !== adapter) throw new Error("Only the configured Allocard adapter can receive sponsored permission");
  return { identity, company, child };
}
async function previewAdapterPermission(actor: string, company: typeof companies.$inferSelect, permission: import("./near-sponsored-action").SponsoredAdapterPermission) {
  const [owner] = await db.select().from(users).where(eq(users.id, company.ownerId)).limit(1);
  if (!owner) throw new Error("Company owner missing");
  const reader = treasuryReader(permission.treasury);
  const [config, path] = await Promise.all([
    verifyTreasuryOwner(permission.treasury, owner.nearAccountId ?? owner.embeddedWalletAddress),
    reader.getPermissionPath(permission.parentId),
  ]);
  const parent = path[0];
  if (config.paused || path.length !== 1 || !parent || parent.id !== permission.parentId || parent.delegate !== actor || parent.issuer !== config.owner || parent.parent_id != null || parent.redelegation_depth < 1) throw new Error("A live company root permission allowing redelegation is required");
  const now = BigInt(Date.now());
  if (parent.revoked || parent.epoch !== config.authority_epoch || BigInt(parent.valid_from_ms) > now || (parent.expires_at_ms && BigInt(parent.expires_at_ms) <= now)) throw new Error("Employee permission is expired or revoked");
  const blocked = await Promise.all([...new Set([actor, config.owner, permission.spec.delegate])].map(principal =>
    reader.caller.viewFunction({contractId:reader.contractId,methodName:"is_principal_blocked",args:{account:principal}}),
  ));
  if (blocked.some(Boolean)) throw new Error("Permission principal is blocked");
  const spec = permission.spec, rule = spec.rules[0], parentRule = parent.rules.find(v => sameAsset(v.asset, SPENDING_ASSET));
  if (!parentRule || BigInt(spec.valid_from_ms) < BigInt(parent.valid_from_ms) || (spec.expires_at_ms && BigInt(spec.expires_at_ms) <= now) || (parent.expires_at_ms && (!spec.expires_at_ms || BigInt(spec.expires_at_ms)>BigInt(parent.expires_at_ms))) || (parent.max_executions != null && (spec.max_executions == null || spec.max_executions>parent.max_executions))) throw new Error("Child permission exceeds its parent lifetime or execution limit");
  if (parent.max_executions != null) {
    const usage=await reader.caller.viewFunction({contractId:reader.contractId,methodName:"get_permission_usage",args:{permission_id:parent.id}});
    if (!Number.isSafeInteger(usage?.executions_count) || usage.executions_count>=parent.max_executions) throw new Error("Parent execution limit reached");
  }
  for (const limit of ["lifetime_limit","max_per_action"] as const) {
    if (parentRule[limit] != null && (rule[limit] == null || BigInt(rule[limit]!)>BigInt(parentRule[limit]!))) throw new Error("Child permission exceeds parent spending limits");
  }
  if (parentRule.min_per_action != null && (rule.min_per_action == null || BigInt(rule.min_per_action)<BigInt(parentRule.min_per_action))) throw new Error("Child minimum is wider than its parent");
  const parentRecipients = parentRule.recipients;
  if (parentRecipients.type==="Only" && (rule.recipients.type!=="Only" || rule.recipients.accounts.some(account=>!parentRecipients.accounts.includes(account)))) throw new Error("Child recipients exceed parent policy");
  for (const policy of ["fixed_window","streaming","approval"] as const) {
    if (canonicalSponsorJson(rule[policy]??null)!==canonicalSponsorJson(parentRule[policy]??null)) throw new Error("Sponsored child must inherit parent window, streaming and approval policy");
  }
}
function adapterJobId(actor: string, permission: import("./near-sponsored-action").SponsoredAdapterPermission) {
  return hash(`adapter_permission\0${permission.treasury}\0${actor}\0${permission.delegationId}`);
}
async function adapterResult(outcome: RpcOutcome, permission: import("./near-sponsored-action").SponsoredAdapterPermission, actor: string) {
  const scope = parseTreasuryReference(permission.treasury);
  const receipts = (outcome as RpcOutcome & { receipts_outcome?: Array<{ outcome: { executor_id: string; status: { SuccessValue?: string; Failure?: unknown } } }> }).receipts_outcome ?? [];
  const candidates = new Set<string>();
  for (const receipt of receipts.filter(value => value.outcome.executor_id === scope.contractId)) {
    if (receipt.outcome.status.Failure !== undefined) throw new Error(`Adapter permission creation failed: ${JSON.stringify(receipt.outcome.status.Failure)}`);
    if (receipt.outcome.status.SuccessValue) candidates.add(decodeMutationId({status:receipt.outcome.status}));
  }
  if (outcome.status.SuccessValue) candidates.add(decodeMutationId(outcome));
  if (candidates.size !== 1) throw new Error("Sponsored transaction confirmed but its child permission result is not available. Retry the same rules to recover the original transaction; do not create a replacement.");
  const [id] = candidates;
  const actual = await treasuryReader(permission.treasury).getPermission(id);
  if (!actual || actual.revoked || actual.issuer !== actor || actual.parent_id !== permission.parentId || actual.delegate !== permission.spec.delegate) throw new Error("The confirmed child permission does not match this employee, parent and adapter");
  return {...outcome,adapterPermissionId:id};
}
export async function prepareSponsoredAdapter(input: import("./near-sponsored-action").SponsoredAdapterPermission) {
  const permission = sponsoredAdapterSchema.parse(input);
  sponsorConfig();
  const {identity,company,child}=await authorizeAdapterPermission(permission);
  await assertTestnet();
  const intentHash=hash(canonicalSponsorJson(permission));
  const existing=await findSponsorJob(adapterJobId(identity.walletAddress,permission));
  if(existing)return {enabled:true,outcome:await adapterResult(await recover(existing,intentHash),permission,identity.walletAddress)};
  if(child.status!=="pending_config")throw new Error("Adapter permission is already active");
  await previewAdapterPermission(identity.walletAddress,company,permission);
  const access=await ensureSigningAccount(identity.walletAddress);
  if(!Number.isSafeInteger(access.block_height))throw new Error("Invalid NEAR block height");
  return {enabled:true,nonce:nextAccessKeyNonce(access.nonce).toString(),maxBlockHeight:String(access.block_height+SPONSORED_VALID_BLOCKS)};
}
export async function submitSponsoredAdapter(input: import("./near-sponsored-action").SponsoredAdapterProof) {
  const proof=sponsoredAdapterProofSchema.parse(input);
  const {nonce,maxBlockHeight,signature,...permission}=proof;
  sponsorConfig();
  const {identity,company,child}=await authorizeAdapterPermission(permission);
  await assertTestnet();
  const id=adapterJobId(identity.walletAddress,permission),intentHash=hash(canonicalSponsorJson(permission));
  const existing=await findSponsorJob(id);
  if(existing)return {enabled:true,outcome:await adapterResult(await recover(existing,intentHash),permission,identity.walletAddress)};
  if(child.status!=="pending_config")throw new Error("Adapter permission is already active");
  const delegate=sponsoredAdapterDelegate(identity.walletAddress,permission,nonce,maxBlockHeight);
  const digest=createHash("sha256").update(sponsoredSigningBytes(delegate)).digest();
  const publicKey=createPublicKey({key:Buffer.concat([Buffer.from("302a300506032b6570032100","hex"),Buffer.from(identity.walletAddress,"hex")]),format:"der",type:"spki"});
  if(!verify(null,digest,publicKey,Buffer.from(signature.slice(2),"hex")))throw new Error("Invalid adapter permission meta-transaction signature");
  const access=await nearQuery({request_type:"view_access_key",account_id:identity.walletAddress,public_key:delegate.publicKey.toString()});
  if(access.permission!=="FullAccess" || delegate.nonce!==nextAccessKeyNonce(access.nonce))throw new Error("Employee nonce changed; retry the same permission with a fresh signature");
  if(!Number.isSafeInteger(access.block_height)||delegate.maxBlockHeight<=BigInt(access.block_height)||delegate.maxBlockHeight>BigInt(access.block_height+SPONSORED_VALID_BLOCKS))throw new Error("Adapter meta-transaction expired or has an excessive validity window");
  await previewAdapterPermission(identity.walletAddress,company,permission);
  const action=new Action({signedDelegate:{delegateAction:delegate,signature:new Signature({keyType:delegate.publicKey.keyType,data:Buffer.from(signature.slice(2),"hex")})}});
  return {enabled:true,outcome:await adapterResult(await submitOuter(id,identity.walletAddress,intentHash,identity.walletAddress,[action]),permission,identity.walletAddress)};
}


async function readToken(contractId: string, methodName: string, args: object) {
  const result = await nearQuery({
    request_type: "call_function",
    account_id: contractId,
    method_name: methodName,
    args_base64: Buffer.from(JSON.stringify(args)).toString("base64"),
  });
  return JSON.parse(Buffer.from(result.result).toString("utf8"));
}

async function tokenStorageMinimum(token: string): Promise<bigint> {
  const bounds = await readToken(token, "storage_balance_bounds", {});
  if (typeof bounds?.min !== "string" || !/^[0-9]+$/.test(bounds.min)) throw new Error("Mock USDC storage price is unavailable");
  const deposit = BigInt(bounds.min);
  if (deposit > 100_000_000_000_000_000_000_000n) throw new Error("Mock USDC storage deposit exceeds the sponsor budget");
  return deposit;
}

async function registerSpendingTokenReceiver(actor: string, receiver: string) {
  const token = MOCK_USDC_ACCOUNT_ID;
  if (!token || await readToken(token, "storage_balance_of", { account_id: receiver }) !== null) return;
  const args = { account_id: receiver, registration_only: true };
  const id = hash(`mock-usdc-storage\0${token}\0${receiver}`);
  await submitOuter(id, actor, hash(canonicalSponsorJson(args)), token, [
    functionCall("storage_deposit", Buffer.from(canonicalSponsorJson(args)), 20_000_000_000_000n, await tokenStorageMinimum(token)),
  ]);
}

export async function fundMockUsdcTreasury(input: {
  owner: string;
  companyId: string;
  treasury: string;
  claimId: string;
}) {
  const token = MOCK_USDC_ACCOUNT_ID;
  if (!token || !sponsorshipEnabled()) throw new Error("Mock USDC funding is unavailable");
  await assertTestnet();
  const scope = parseTreasuryReference(input.treasury);
  if (!scope.companyId || scope.companyId !== computeCompanyId(input.owner, input.companyId)) {
    throw new Error("Mock USDC funding requires this company's shared treasury");
  }
  const config = sponsorConfig();
  if (!token.endsWith(".testnet") || await readToken(token, "get_minter", {}) !== config.accountId) {
    throw new Error("The configured test token must authorize the relayer as its minter");
  }
  const ledger = await treasuryReader(input.treasury, { cacheMs: 0 }).getAssetLedger(SPENDING_ASSET);
  if (!ledger?.enabled) throw new Error("Mock USDC is not enabled for this company treasury");
  const activation = input.claimId === "activation";
  const claim = activation ? "activation" : z.uuid().parse(input.claimId);
  const amount = parseTokenAmount(activation ? ACTIVATION_USDC : FAUCET_USDC, SPENDING_DECIMALS);
  const id = hash(`mock-usdc-claim\0${token}\0${input.companyId}\0${claim}`);
  const intentHash = hash(canonicalSponsorJson({ treasury: input.treasury, amount }));
  const previous = await findSponsorJob(id);
  if (previous) {
    const outcome = await recover(previous, intentHash);
    return creditedMockUsdc(id, outcome, amount);
  }

  const companyArgs = Buffer.from(canonicalSponsorJson({ company_id: scope.companyId }));
  if (activation) {
    // Contract storage and the FT transfer deposit still use native NEAR.
    const reserveId = hash(`mock-usdc-reserves\0${input.treasury}`);
    await submitOuter(reserveId, input.owner, reserveId, scope.contractId, [
      functionCall("top_up_storage", companyArgs, 30_000_000_000_000n, 200_000_000_000_000_000_000_000n),
      functionCall("top_up_operating", companyArgs, 30_000_000_000_000n, 20_000_000_000_000_000_000_000n),
    ]);
  }
  const actions: Action[] = [];
  const registrationDeposit = await tokenStorageMinimum(token);
  for (const accountId of new Set([config.accountId, scope.contractId])) {
    if (await readToken(token, "storage_balance_of", { account_id: accountId }) === null) {
      actions.push(functionCall("storage_deposit", Buffer.from(canonicalSponsorJson({ account_id: accountId, registration_only: true })), 15_000_000_000_000n, registrationDeposit));
    }
  }
  actions.push(
    functionCall("mint", Buffer.from(canonicalSponsorJson({ amount })), 15_000_000_000_000n, 0n),
    functionCall("ft_transfer_call", Buffer.from(canonicalSponsorJson({ receiver_id: scope.contractId, amount, msg: companyArgs.toString("utf8") })), 110_000_000_000_000n, 1n),
  );
  const outcome = await submitOuter(id, input.owner, intentHash, token, actions);
  return creditedMockUsdc(id, outcome, amount);
}

async function creditedMockUsdc(id: string, outcome: RpcOutcome, amount: string) {
  const result = JSON.parse(Buffer.from(outcome.status.SuccessValue ?? "", "base64").toString("utf8") || "null");
  if (result === "0") {
    await releaseUncreditedFaucetJob(id, outcome.transaction.hash);
    throw new Error("The treasury rejected the deposit. Retry this claim after checking the treasury setup.");
  }
  if (result !== amount) throw new Error("The token transfer did not credit the full treasury claim. Check the transaction before retrying.");
  return { txHash: outcome.transaction.hash, amount };
}
