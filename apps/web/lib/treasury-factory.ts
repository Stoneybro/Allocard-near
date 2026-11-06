import type { NearCaller } from "@allocard/delegation-sdk";
import { createNearRpcCaller } from "./near";
import { isNativeNearAccount } from "./wallet";
export type FactoryConfig = { factoryId: string; treasury_code_hash: string; network_domain: string; account_funding: string; record_funding: string; creation_deposit: string };
export type Creation = { owner: string; treasury_id: string; status: "Pending" | "Ready" | "RefundAvailable" | "Refunding" | "Refunded"; account_funding: string };
export async function factoryConfig(): Promise<FactoryConfig> {
  const response = await fetch("/api/treasury/factory", { cache: "no-store" });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || "Treasury factory is unavailable");
  if (!isNativeNearAccount(result.factoryId) || result.network_domain !== "near:testnet" || !/^[1-9][0-9]*$/.test(result.creation_deposit)) throw new Error("Invalid treasury factory configuration");
  return result;
}
export async function readCreation(config: FactoryConfig, owner: string, companyKey: string): Promise<Creation | null> {
  const rpc = createNearRpcCaller();
  const args = { owner, company_key: companyKey };
  const [record, target] = await Promise.all([
    rpc.viewFunction({ contractId: config.factoryId, methodName: "get_creation", args }),
    rpc.viewFunction({ contractId: config.factoryId, methodName: "get_treasury_id", args }),
  ]);
  if (record && (record.owner !== owner || record.treasury_id !== target)) throw new Error("Factory creation does not match this workspace and owner");
  return record;
}
export function readyTreasury(record: Creation | null): string {
  if (!record) throw new Error("Creation is not finalized yet. Retry to check the same workspace; do not create another company.");
  if (record.status === "Ready") return record.treasury_id;
  if (record.status === "Pending") throw new Error("Treasury creation is pending. Retry to check its status without paying again.");
  if (record.status === "RefundAvailable") throw new Error("Treasury setup failed. Claim the setup refund below; registry storage funding is retained.");
  if (record.status === "Refunding") throw new Error("Your setup refund is pending. Retry after finality.");
  throw new Error("Setup was refunded. Keep this workspace and ask the operator to resolve provisioning before another attempt.");
}
export async function provisionTreasury(caller: NearCaller, config: FactoryConfig, companyKey: string): Promise<string> {
  if (!caller.accountId || !caller.functionCall) throw new Error("Connect your NEAR signing wallet first");
  const existing = await readCreation(config, caller.accountId, companyKey);
  if (existing && existing.status !== "Refunded") return readyTreasury(existing);
  let submissionError: unknown;
  try {
    await caller.functionCall({ contractId: config.factoryId, methodName: "create_company", args: { company_key: companyKey }, gas: "150000000000000", attachedDeposit: config.creation_deposit });
  } catch (error) { submissionError = error; }
  const record = await readCreation(config, caller.accountId, companyKey);
  if (!record && submissionError) throw submissionError;
  return readyTreasury(record);
}
