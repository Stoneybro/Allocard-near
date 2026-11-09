import { Buffer } from "buffer";
import { parseTreasuryReference, type ExecuteRequest } from "@allocard/delegation-sdk";
import { sponsoredAdapterDelegate, canonicalSponsorJson, sponsoredCompanyDelegate, sponsoredDelegate, sponsoredSigningBytes, type SponsoredAdapterPermission, type SponsoredCompany, type SponsoredPayment } from "./near-sponsored-action";
import { paymentSubmission, TransactionNotSubmittedError } from "./payment-submission";

async function sponsorRequest(operation: "prepare" | "submit" | "prepare-company" | "submit-company" | "prepare-adapter" | "submit-adapter", body: object) {
  let response: Response;
  try {
    response = await fetch("/api/near/sponsor", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ operation, ...body }),
      signal: AbortSignal.timeout(120000),
    });
  } catch {
    throw new Error("Gas sponsorship could not be confirmed. Retry this same action to check its status.");
  }
  const result = await response.json().catch(() => null);
  if (!response.ok || !result) {
    const message=result?.error ?? "Gas sponsorship could not be confirmed. Retry the same action to check its status.";
    if(result?.submissionState==="not_submitted")throw new TransactionNotSubmittedError(message);
    throw new Error(message);
  }
  return result;
}

export async function sponsoredExecute(accountId: string, receiverId: string, args: { request: ExecuteRequest; company_id?: string }, signHash: (hash: `0x${string}`) => Promise<`0x${string}`>) {
  const payment: SponsoredPayment = { treasury: args.company_id ? `${receiverId}#${args.company_id}` : receiverId, request: args.request };
  const noteSubmission=paymentSubmission(accountId,payment.treasury,payment.request.request_id);
  const prepared = await sponsorRequest("prepare", payment);
  if (!prepared.enabled) return null;
  // Recovery returns the original confirmed transaction, without a fresh signature.
  if (prepared.outcome) return prepared.outcome;
  const scope = parseTreasuryReference(payment.treasury);
  const delegate = sponsoredDelegate(accountId, scope.contractId, args, prepared.nonce, prepared.maxBlockHeight);
  const digest = await crypto.subtle.digest("SHA-256", sponsoredSigningBytes(delegate));
  const signature = await signHash(`0x${Buffer.from(digest).toString("hex")}`);
  if (!/^0x[0-9a-fA-F]{128}$/.test(signature)) throw new Error("Privy did not return an Ed25519 signature");
  noteSubmission(true);
  let result;
  try { result = await sponsorRequest("submit", { ...payment, nonce: prepared.nonce, maxBlockHeight: prepared.maxBlockHeight, signature }); }
  catch(caught){if(caught instanceof TransactionNotSubmittedError)noteSubmission(false);throw caught;}
  if (!result.outcome) throw new Error("Sponsored payment has no confirmed outcome. Retry the same action to check its status.");
  return result.outcome;
}

export async function sponsoredCreateCompany(accountId: string, company: SponsoredCompany, signHash: (hash: `0x${string}`) => Promise<`0x${string}`>) {
  const prepared = await sponsorRequest("prepare-company", company);
  if (!prepared.enabled) return null;
  if (prepared.registered) return { registered: true };
  if (prepared.outcome) return prepared.outcome;
  const delegate = sponsoredCompanyDelegate(accountId, company, prepared.nonce, prepared.maxBlockHeight);
  const digest = await crypto.subtle.digest("SHA-256", sponsoredSigningBytes(delegate));
  const signature = await signHash(`0x${Buffer.from(digest).toString("hex")}`);
  if (!/^0x[0-9a-fA-F]{128}$/.test(signature)) throw new Error("Privy did not return an Ed25519 signature");
  const result = await sponsorRequest("submit-company", { ...company, nonce: prepared.nonce, maxBlockHeight: prepared.maxBlockHeight, signature });
  if (result.registered) return { registered: true };
  if (!result.outcome) throw new Error("Company registration could not be confirmed. Retry this workspace to check its status.");
  return result.outcome;
}

const adapterIntentKey = (accountId: string, delegationId: string) => `allocard:adapter-permission:${accountId}:${delegationId}`;
export function clearAdapterPermissionIntent(accountId: string, delegationId: string) {
  localStorage.removeItem(adapterIntentKey(accountId, delegationId));
}
export async function sponsoredCreateAdapter(accountId: string, input: SponsoredAdapterPermission, signHash: (hash: `0x${string}`) => Promise<`0x${string}`>) {
  // Preserve the exact approved spec across reloads, timeouts and DB activation failures.
  const key = adapterIntentKey(accountId, input.delegationId);
  let permission = input;
  if (typeof localStorage !== "undefined") {
    const raw = localStorage.getItem(key);
    if (raw) {
      const saved = JSON.parse(raw) as SponsoredAdapterPermission;
      const normalized = (value: SponsoredAdapterPermission) => canonicalSponsorJson({...value,spec:{...value.spec,valid_from_ms:"0"}});
      if (normalized(saved) !== normalized(input)) throw new Error("The previous adapter request has different rules. Restore its original rules and recover it before creating another permission.");
      permission = saved;
    } else localStorage.setItem(key, JSON.stringify(input));
  }
  const prepared = await sponsorRequest("prepare-adapter", permission);
  if (!prepared.enabled) throw new Error("Adapter gas sponsorship is disabled. Ask the operator to enable NEAR_SPONSOR_ENABLED; no wallet-funded fallback was signed.");
  if (prepared.outcome) return prepared.outcome;
  const delegate = sponsoredAdapterDelegate(accountId, permission, prepared.nonce, prepared.maxBlockHeight);
  const digest = await crypto.subtle.digest("SHA-256", sponsoredSigningBytes(delegate));
  const signature = await signHash(`0x${Buffer.from(digest).toString("hex")}`);
  if (!/^0x[0-9a-fA-F]{128}$/.test(signature)) throw new Error("Invalid employee meta-transaction signature");
  const result = await sponsorRequest("submit-adapter", {...permission,nonce:prepared.nonce,maxBlockHeight:prepared.maxBlockHeight,signature});
  if (!result.outcome) throw new Error("Adapter sponsorship is not confirmed. Retry the same permission to recover its original transaction.");
  return result.outcome;
}
