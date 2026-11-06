import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@noble/hashes/utils.js";
const accountPattern = /^(([a-z\d]+[-_])*[a-z\d]+\.)*([a-z\d]+[-_])*[a-z\d]+$/;
export function computeCompanyId(owner: string, companyKey: string): string {
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(companyKey)) throw new Error("Invalid company key");
  if (parseTreasuryReference(owner).companyId) throw new Error("Expected an owner account ID");
  return bytesToHex(sha256(new TextEncoder().encode(`${owner}\0${companyKey}`)));
}
/** Internal persisted reference: native contract account plus an optional company namespace. */
export function parseTreasuryReference(value: string): { contractId: string; companyId?: string } {
  const parts=value.split("#");
  const contractId=parts[0];
  if (parts.length>2 || contractId.length<2 || contractId.length>64 || contractId.startsWith("0x") || !accountPattern.test(contractId) || (parts.length===2 && !/^[0-9a-f]{64}$/.test(parts[1]))) throw new Error("Invalid treasury reference");
  return { contractId, ...(parts.length===2 ? { companyId: parts[1] } : {}) };
}
export function treasuryReference(contractId: string, companyId: string): string {
  const ref=`${contractId}#${companyId}`;
  parseTreasuryReference(ref);
  return ref;
}
export function companyNetworkDomain(network: string, companyId?: string) { return companyId ? `${network}:company:${companyId}` : network; }
