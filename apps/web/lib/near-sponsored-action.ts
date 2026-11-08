import { Buffer } from "buffer";
import { utils } from "near-api-js";
import { encodeDelegateAction, functionCall } from "near-api-js/lib/transaction";
import type { ExecuteRequest } from "@allocard/delegation-sdk";

// NEP-366 with a regular Ed25519 access key. Both sides build this exact action.
export const SPONSORED_EXECUTE_GAS = "150000000000000";
export const SPONSORED_COMPANY_GAS = "70000000000000";
export const MAX_SPONSORED_COMPANY_DEPOSIT = "200000000000000000000000"; // 0.2 NEAR
export const SPONSORED_VALID_BLOCKS = 120;
export type SponsoredCompany = { companyKey: string; contractId: string; deposit: string };
export type SponsoredCompanyProof = SponsoredCompany & { nonce: string; maxBlockHeight: string; signature: string };
export type SponsoredPayment = { treasury: string; request: ExecuteRequest };
export type SponsoredProof = SponsoredPayment & { nonce: string; maxBlockHeight: string; signature: string };
export function canonicalSponsorJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
}
function delegateAction(accountId: string, receiverId: string, method: "execute" | "create_company", args: object, gas: string, deposit: string, nonce: string, maxBlockHeight: string) {
  if (!/^[0-9a-f]{64}$/.test(accountId)) throw new Error("Sponsorship requires a NEAR implicit account");
  if (![nonce, maxBlockHeight].every(value => /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) < 2n ** 64n)) throw new Error("Invalid sponsored transaction nonce or expiry");
  return {
    senderId: accountId, receiverId,
    actions: [functionCall(method, Buffer.from(canonicalSponsorJson(args)), BigInt(gas), BigInt(deposit))],
    nonce: BigInt(nonce), maxBlockHeight: BigInt(maxBlockHeight),
    publicKey: utils.PublicKey.fromString(`ed25519:${utils.serialize.base_encode(Buffer.from(accountId, "hex"))}`),
  };
}
export function sponsoredDelegate(accountId: string, receiverId: string, args: object, nonce: string, maxBlockHeight: string) {
  return delegateAction(accountId, receiverId, "execute", args, SPONSORED_EXECUTE_GAS, "0", nonce, maxBlockHeight);
}
export function sponsoredCompanyDelegate(accountId: string, company: SponsoredCompany, nonce: string, maxBlockHeight: string) {
  if (!/^[1-9][0-9]*$/.test(company.deposit) || BigInt(company.deposit) > BigInt(MAX_SPONSORED_COMPANY_DEPOSIT)) throw new Error("Company sponsorship deposit exceeds 0.2 NEAR");
  return delegateAction(accountId, company.contractId, "create_company", { company_key: company.companyKey }, SPONSORED_COMPANY_GAS, company.deposit, nonce, maxBlockHeight);
}
export function sponsoredSigningBytes(delegate: ReturnType<typeof sponsoredDelegate>) {
  // Includes the NEP-461 domain prefix; regular transaction signatures cannot be reused.
  return new Uint8Array(encodeDelegateAction(delegate));
}
