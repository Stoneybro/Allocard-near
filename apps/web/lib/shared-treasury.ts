import { MOCK_USDC_ACCOUNT_ID, SPENDING_ASSET } from "./chain";
import { computeCompanyId, treasuryReference, type NearCaller } from "@allocard/delegation-sdk";
import { createNearRpcCaller } from "./near";
export type SharedConfig = { contractId: string; schema_version: number; network_domain: string; creation_deposit: string };
export async function sharedConfig(): Promise<SharedConfig> {
  const response = await fetch("/api/treasury/shared", { cache: "no-store" });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.error || "Shared treasury unavailable");
  if (![3, 4, 5].includes(payload.schema_version) || payload.network_domain !== "near:testnet") throw new Error("Unsupported shared treasury");
  return payload;
}
export async function registerCompany(caller: NearCaller, config: SharedConfig, companyKey: string, onStage?: (message: string) => void): Promise<string> {
  if (!caller.accountId || !caller.functionCall) throw new Error("A signing wallet is required");
  if (config.schema_version < 5) throw new Error("New company setup requires the treasury reservation release. Ask the operator to configure the new shared contract.");
  const companyId = computeCompanyId(caller.accountId, companyKey);
  const reader = createNearRpcCaller();
  const exists = () => reader.viewFunction({ contractId: config.contractId, methodName: "company_exists", args: { company_id: companyId } });
  const reference = treasuryReference(config.contractId, companyId);
  const activateAsset = async () => {
    onStage?.("Checking treasury spending access…");
    if (MOCK_USDC_ACCOUNT_ID) {
      const args = { company_id: companyId, asset: SPENDING_ASSET };
      const ledger = await reader.viewFunction({ contractId: config.contractId, methodName: "get_asset_ledger", args });
      if (!ledger) {
        await caller.functionCall!({ contractId: config.contractId, methodName: "register_asset", args, gas: "25000000000000", attachedDeposit: "0" });
      }
      if (!ledger?.enabled) {
        await caller.functionCall!({ contractId: config.contractId, methodName: "set_asset_enabled", args: { ...args, enabled: true }, gas: "25000000000000", attachedDeposit: "0" });
      }
    }
    return reference;
  };
  onStage?.("Checking your company treasury…");
  if (await exists()) return activateAsset();
  onStage?.("Waiting for your signature and treasury confirmation…");
  let error: unknown;
  try { await caller.functionCall({ contractId: config.contractId, methodName: "create_company", args: { company_key: companyKey }, gas: "70000000000000", attachedDeposit: config.creation_deposit }); }
  catch (caught) { error = caught; }
  onStage?.("Confirming treasury setup…");
  if (await exists()) return activateAsset();
  if (error) throw error;
  throw new Error("Company registration is not finalized. Retry this workspace to check its status before paying again.");
}
