import { MOCK_USDC_ACCOUNT_ID, SPENDING_ASSET } from "./chain";
import { Buffer } from "buffer";
import { utils } from "near-api-js";
import { encodeDelegateAction, functionCall } from "near-api-js/lib/transaction";
import { computeCompanyId, parseTreasuryReference, type ExecuteRequest, type PermissionSpec } from "@allocard/delegation-sdk";

// NEP-366 with a regular Ed25519 access key. Both sides build this exact action.
export const SPONSORED_EXECUTE_GAS = "150000000000000";
export const SPONSORED_COMPANY_GAS = "70000000000000";
export const MAX_SPONSORED_COMPANY_DEPOSIT = "200000000000000000000000"; // 0.2 NEAR
export const COMPANY_STORAGE_TOP_UP = "200000000000000000000000";
export const COMPANY_OPERATING_TOP_UP = "20000000000000000000000";
export const SPONSORED_VALID_BLOCKS = 120;
export type SponsoredCompany = { companyKey: string; contractId: string; deposit: string; fundReserves?: true };
export type SponsoredCompanyProof = SponsoredCompany & { nonce: string; maxBlockHeight: string; signature: string };
export type SponsoredPayment = { treasury: string; request: ExecuteRequest };
export type SponsoredProof = SponsoredPayment & { nonce: string; maxBlockHeight: string; signature: string };
export type SponsoredAdapterPermission = { treasury: string; delegationId: string; parentId: string; spec: PermissionSpec };
export type SponsoredRevocation = { treasury: string; permissionId: string };
export type SponsoredRevocationProof = SponsoredRevocation & { nonce: string; maxBlockHeight: string; signature: string };
export type SponsoredRootPermission = { treasury: string; delegationId: string; spec: PermissionSpec };
export type SponsoredRootProof = SponsoredRootPermission & { nonce: string; maxBlockHeight: string; signature: string };
export type SponsoredAdapterProof = SponsoredAdapterPermission & { nonce: string; maxBlockHeight: string; signature: string };
export function canonicalSponsorJson(value: unknown): string {
  return JSON.stringify(value, (_key, item) => item && typeof item === "object" && !Array.isArray(item)
    ? Object.fromEntries(Object.entries(item).sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0)) : item);
}
function delegateAction(accountId: string, receiverId: string, method: "execute" | "create_company" | "create_child_permission" | "create_root_permission" | "revoke_permission", args: object, gas: string, deposit: string, nonce: string, maxBlockHeight: string) {
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
  const action = delegateAction(accountId, company.contractId, "create_company", { company_key: company.companyKey }, SPONSORED_COMPANY_GAS, company.deposit, nonce, maxBlockHeight);
  if (MOCK_USDC_ACCOUNT_ID) {
    const companyId = computeCompanyId(accountId, company.companyKey);
    const args = { company_id: companyId, asset: SPENDING_ASSET };
    action.actions.push(
      functionCall("register_asset", Buffer.from(canonicalSponsorJson(args)), 25_000_000_000_000n, 0n),
      functionCall("set_asset_enabled", Buffer.from(canonicalSponsorJson({ ...args, enabled: true })), 25_000_000_000_000n, 0n),
    );
    if (company.fundReserves) action.actions.push(
      functionCall("top_up_storage", Buffer.from(canonicalSponsorJson({ company_id: companyId })), 30_000_000_000_000n, BigInt(COMPANY_STORAGE_TOP_UP)),
      functionCall("top_up_operating", Buffer.from(canonicalSponsorJson({ company_id: companyId })), 30_000_000_000_000n, BigInt(COMPANY_OPERATING_TOP_UP)),
    );
  }
  return action;
}
export function sponsoredAdapterDelegate(accountId: string, permission: SponsoredAdapterPermission, nonce: string, maxBlockHeight: string) {
  const scope = parseTreasuryReference(permission.treasury);
  return delegateAction(accountId, scope.contractId, "create_child_permission", { parent_id: permission.parentId, spec: permission.spec, ...(scope.companyId ? { company_id: scope.companyId } : {}) }, "80000000000000", "0", nonce, maxBlockHeight);
}
export function sponsoredRootDelegate(accountId: string, permission: SponsoredRootPermission, nonce: string, maxBlockHeight: string) {
  const scope = parseTreasuryReference(permission.treasury);
  return delegateAction(accountId, scope.contractId, "create_root_permission", { spec: permission.spec, ...(scope.companyId ? { company_id: scope.companyId } : {}) }, "80000000000000", "0", nonce, maxBlockHeight);
}
export function sponsoredRevokeDelegate(accountId: string, input: SponsoredRevocation, nonce: string, maxBlockHeight: string) {
  const scope = parseTreasuryReference(input.treasury);
  return delegateAction(accountId, scope.contractId, "revoke_permission", { permission_id: input.permissionId, ...(scope.companyId ? { company_id: scope.companyId } : {}) }, "80000000000000", "0", nonce, maxBlockHeight);
}
export function sponsoredSigningBytes(delegate: ReturnType<typeof sponsoredDelegate>) {
  // Includes the NEP-461 domain prefix; regular transaction signatures cannot be reused.
  return new Uint8Array(encodeDelegateAction(delegate));
}
