import { computeCompanyId, treasuryReference, type NearCaller } from "@allocard/delegation-sdk";
import { createNearRpcCaller } from "./near";
export type SharedConfig = { contractId: string; schema_version: number; network_domain: string; creation_deposit: string };
export async function sharedConfig(): Promise<SharedConfig> {
  const response = await fetch("/api/treasury/shared", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Shared treasury unavailable");
  if (payload.schema_version !== 3 || payload.network_domain !== "near:testnet") throw new Error("Unsupported shared treasury");
  return payload;
}
export async function registerCompany(caller: NearCaller, config: SharedConfig, companyKey: string): Promise<string> {
  if (!caller.accountId || !caller.functionCall) throw new Error("A signing wallet is required");
  const companyId = computeCompanyId(caller.accountId, companyKey);
  const reader = createNearRpcCaller();
  const exists = () => reader.viewFunction({ contractId: config.contractId, methodName: "company_exists", args: { company_id: companyId } });
  if (await exists()) return treasuryReference(config.contractId, companyId);
  let error: unknown;
  try { await caller.functionCall({ contractId: config.contractId, methodName: "create_company", args: { company_key: companyKey }, gas: "70000000000000", attachedDeposit: config.creation_deposit }); }
  catch (caught) { error = caught; }
  if (await exists()) return treasuryReference(config.contractId, companyId);
  if (error) throw error;
  throw new Error("Company registration is not finalized. Retry this workspace to check its status before paying again.");
}
