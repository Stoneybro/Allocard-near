import "server-only";
import { createHash, createPublicKey, verify } from "node:crypto";
import { Action, Signature } from "near-api-js/lib/transaction";
import { and, eq } from "drizzle-orm";
import { db } from "./db";
import { companies, companyMemberships, delegations, users } from "./db/schema";
import { requireSessionUser } from "./auth-guard";
import { getSessionIdentity } from "./session";
import { sponsoredRevokeSchema, sponsoredRevokeProofSchema } from "./adapter-permission-schema";
import { sponsoredRevokeDelegate, sponsoredSigningBytes, canonicalSponsorJson, SPONSORED_VALID_BLOCKS, type SponsoredRevocation, type SponsoredRevocationProof } from "./near-sponsored-action";
import { assertTestnet, ensureSigningAccount, sponsorConfig, submitOuter, recover } from "./near-sponsor-server";
import { findSponsorJob } from "./near-sponsor-store";
import { nearQuery, treasuryReader, verifyTreasuryOwner } from "./near-server";
import { nextAccessKeyNonce } from "./near-nonce";
import { TransactionNotSubmittedError } from "./payment-submission";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const jobId = (actor: string, input: SponsoredRevocation) => hash(`revoke_permission\0${input.treasury}\0${actor}\0${input.permissionId}`);

async function authorize(input: SponsoredRevocation) {
  sponsorConfig();
  const identity = await getSessionIdentity();
  const user = await requireSessionUser();
  if (!identity || !/^[0-9a-f]{64}$/.test(identity.walletAddress) || user.privyUserId !== identity.providerUserId || identity.providerUserId.startsWith("near:")) throw new Error("Verified signing wallet required");
  const [company] = await db.select().from(companies).where(eq(companies.smartAccountAddress, input.treasury)).limit(1);
  if (!company) throw new Error("Registered company treasury required");
  const owner = company.ownerId === user.id;
  const [membership] = await db.select().from(companyMemberships).where(and(eq(companyMemberships.companyId, company.id), eq(companyMemberships.userId, user.id), eq(companyMemberships.status, "active"), owner ? eq(companyMemberships.canEmployer, true) : eq(companyMemberships.canEmployee, true))).limit(1);
  if (!membership) throw new Error("Active company membership is required to revoke access");
  if (!owner) {
    const [grant] = await db.select().from(delegations).where(and(eq(delegations.treasuryReference, input.treasury), eq(delegations.delegationHash, input.permissionId), eq(delegations.delegatorType, "user"), eq(delegations.delegatorId, user.id), eq(delegations.delegateeType, "agent"))).limit(1);
    if (!grant) throw new Error("Only your own agent permission can be revoked");
  }
  const [companyOwner] = await db.select().from(users).where(eq(users.id, company.ownerId)).limit(1);
  if (!companyOwner) throw new Error("Company owner missing");
  const reader = treasuryReader(input.treasury);
  const [, permission] = await Promise.all([
    verifyTreasuryOwner(input.treasury, companyOwner.nearAccountId ?? companyOwner.embeddedWalletAddress), reader.getPermission(input.permissionId),
  ]);
  // Revocation must remain available while paused, expired or blocked.
  if (!permission || (!owner && permission.issuer !== identity.walletAddress) || (owner && (companyOwner.nearAccountId ?? companyOwner.embeddedWalletAddress) !== identity.walletAddress)) throw new Error("This wallet cannot revoke that permission");
  return { identity, reader, permission };
}

export async function prepareSponsoredRevoke(value: SponsoredRevocation) {
  const input = sponsoredRevokeSchema.parse(value);
  const { identity, reader, permission } = await authorize(input);
  if (permission.revoked) return { enabled: true, revoked: true };
  await assertTestnet();
  const existing = await findSponsorJob(jobId(identity.walletAddress, input));
  if (existing) {
    const outcome = await recover(existing, hash(canonicalSponsorJson(input)));
    if (!(await reader.getPermission(input.permissionId))?.revoked) throw new Error("Revocation is not yet visible. Retry the original request.");
    return { enabled: true, outcome };
  }
  const access = await ensureSigningAccount(identity.walletAddress);
  if (!Number.isSafeInteger(access.block_height)) throw new TransactionNotSubmittedError("Invalid NEAR block height");
  return { enabled: true, nonce: nextAccessKeyNonce(access.nonce).toString(), maxBlockHeight: String(access.block_height + SPONSORED_VALID_BLOCKS) };
}

export async function submitSponsoredRevoke(value: SponsoredRevocationProof) {
  const { nonce, maxBlockHeight, signature, ...input } = sponsoredRevokeProofSchema.parse(value);
  const { identity, reader, permission } = await authorize(input);
  if (permission.revoked) return { enabled: true, revoked: true };
  await assertTestnet();
  const id = jobId(identity.walletAddress, input), intentHash = hash(canonicalSponsorJson(input));
  const existing = await findSponsorJob(id);
  if (existing) {
    const outcome = await recover(existing, intentHash);
    if (!(await reader.getPermission(input.permissionId))?.revoked) throw new Error("Revocation is not yet visible. Retry the original request.");
    return { enabled: true, outcome };
  }
  const delegate = sponsoredRevokeDelegate(identity.walletAddress, input, nonce, maxBlockHeight);
  const digest = createHash("sha256").update(sponsoredSigningBytes(delegate)).digest();
  const key = createPublicKey({ key: Buffer.concat([Buffer.from("302a300506032b6570032100", "hex"), Buffer.from(identity.walletAddress, "hex")]), format: "der", type: "spki" });
  if (!verify(null, digest, key, Buffer.from(signature.slice(2), "hex"))) throw new TransactionNotSubmittedError("Invalid permission revocation signature");
  const access = await nearQuery({ request_type: "view_access_key", account_id: identity.walletAddress, public_key: delegate.publicKey.toString() });
  if (access.permission !== "FullAccess" || delegate.nonce !== nextAccessKeyNonce(access.nonce) || !Number.isSafeInteger(access.block_height) || delegate.maxBlockHeight <= BigInt(access.block_height) || delegate.maxBlockHeight > BigInt(access.block_height + SPONSORED_VALID_BLOCKS)) throw new TransactionNotSubmittedError("Revocation signature nonce or expiry changed. Retry the same permission.");
  const action = new Action({ signedDelegate: { delegateAction: delegate, signature: new Signature({ keyType: delegate.publicKey.keyType, data: Buffer.from(signature.slice(2), "hex") }) } });
  const outcome = await submitOuter(id, identity.walletAddress, intentHash, identity.walletAddress, [action]);
  if (!(await reader.getPermission(input.permissionId))?.revoked) throw new Error("Revocation was submitted but is not yet visible. Retry the original request.");
  return { enabled: true, outcome };
}
