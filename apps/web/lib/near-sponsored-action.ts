import { Buffer } from "buffer";
import { utils } from "near-api-js";
import { encodeDelegateAction, functionCall } from "near-api-js/lib/transaction";
import type { ExecuteRequest } from "@allocard/delegation-sdk";

// NEP-366 with a regular Ed25519 access key. Both sides build this exact action.
export const SPONSORED_EXECUTE_GAS = "150000000000000";
export const SPONSORED_VALID_BLOCKS = 120;
export type SponsoredPayment = { treasury: string; request: ExecuteRequest };
export type SponsoredProof = SponsoredPayment & { nonce: string; maxBlockHeight: string; signature: string };
export function canonicalSponsorJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
}
export function sponsoredDelegate(accountId: string, receiverId: string, args: object, nonce: string, maxBlockHeight: string) {
  if (!/^[0-9a-f]{64}$/.test(accountId)) throw new Error("Sponsorship requires a NEAR implicit account");
  if (![nonce, maxBlockHeight].every(value => /^(0|[1-9][0-9]*)$/.test(value) && BigInt(value) < 2n ** 64n)) throw new Error("Invalid sponsored transaction nonce or expiry");
  return {
    senderId: accountId, receiverId,
    actions: [functionCall("execute", Buffer.from(canonicalSponsorJson(args)), BigInt(SPONSORED_EXECUTE_GAS), 0n)],
    nonce: BigInt(nonce), maxBlockHeight: BigInt(maxBlockHeight),
    publicKey: utils.PublicKey.fromString(`ed25519:${utils.serialize.base_encode(Buffer.from(accountId, "hex"))}`),
  };
}
export function sponsoredSigningBytes(delegate: ReturnType<typeof sponsoredDelegate>) {
  // Includes the NEP-461 domain prefix; regular transaction signatures cannot be reused.
  return new Uint8Array(encodeDelegateAction(delegate));
}
