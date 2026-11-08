import type { AllocardTreasuryClient, BudgetScope, Usage } from "@allocard/delegation-sdk";
import { formatTokenAmount } from "@allocard/delegation-sdk";
import { nativeSpendingCapacity } from "./spending-capacity";
import { NearReadError } from "./near-read-error";

export async function readLiveNativeCapacity(reader: AllocardTreasuryClient, actor: string, permissionId: string) {
  const [path, config, ledger] = await Promise.all([
    reader.getPermissionPath(permissionId), reader.getConfig(), reader.getAssetLedger({ type: "NativeNear" }),
  ]);
  if (!Array.isArray(path)) throw new NearReadError("get_permission_path", "INVALID_RESPONSE", "Expected an on-chain permission path.");
  if (typeof config?.paused !== "boolean" || !/^[0-9]+$/.test(config?.authority_epoch)) throw new NearReadError("get_config", "INVALID_RESPONSE", "Expected the company treasury configuration.");
  if (ledger && (typeof ledger.enabled !== "boolean" || !/^[0-9]+$/.test(ledger.available))) throw new NearReadError("get_asset_ledger", "INVALID_RESPONSE", "Expected a valid native treasury balance.");
  const usageCache = new Map<string, Promise<Usage>>();
  const blockedCache = new Map<string, Promise<boolean>>();
  const countCache = new Map<string, Promise<number>>();
  const usage = (id: string, scope: BudgetScope) => {
    const key = `${id}:${JSON.stringify(scope)}`;
    if (!usageCache.has(key)) usageCache.set(key, reader.getUsage(id, { type: "NativeNear" }, scope).then(value => { if (!/^[0-9]+$/.test(value?.settled) || !/^[0-9]+$/.test(value?.pending)) throw new NearReadError("get_usage", "INVALID_RESPONSE", "Expected valid pending and settled usage counters."); return value; }));
    return usageCache.get(key)!;
  };
  const blocked = (account: string) => {
    if (!blockedCache.has(account)) blockedCache.set(account, reader.caller.viewFunction({ contractId: reader.contractId, methodName: "is_principal_blocked", args: { account } }).then(value => { if (typeof value !== "boolean") throw new NearReadError("is_principal_blocked", "INVALID_RESPONSE", "Expected an account-blocking status."); return value; }));
    return blockedCache.get(account)!;
  };
  const executionCount = (id: string) => {
    if (!countCache.has(id)) countCache.set(id, reader.caller.viewFunction({ contractId: reader.contractId, methodName: "get_permission_usage", args: { permission_id: id } }).then(value => { if (!Number.isSafeInteger(value?.executions_count) || value.executions_count < 0) throw new NearReadError("get_permission_usage", "INVALID_RESPONSE", "Expected a valid execution count."); return value.executions_count; }));
    return countCache.get(id)!;
  };
  const remaining = await nativeSpendingCapacity({ actor, path, config, available: ledger?.enabled ? ledger.available : "0", now: BigInt(Date.now()), usage, blocked, executionCount });
  const lifetime = await usage(permissionId, { type: "Lifetime" });
  const rule = path[0]?.rules.find(rule => rule.asset.type === "NativeNear");
  return { remainingNear: formatTokenAmount(remaining, 24), approvedNear: formatTokenAmount(rule?.lifetime_limit ?? "0", 24), spentNear: formatTokenAmount(lifetime.settled, 24) };
}
export function capacityReadError(caught: unknown): string {
  const detail = caught instanceof NearReadError ? caught.message : "The treasury returned an unexpected response.";
  return `Live spending capacity could not be verified. ${detail} Payments remain disabled until this read succeeds.`;
}
