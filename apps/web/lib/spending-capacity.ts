import { SPENDING_ASSET, sameAsset } from "@/lib/chain";
import type { BudgetScope, Permission, TreasuryConfig, Usage } from "@allocard/delegation-sdk";
/** Advisory snapshot; execute rechecks the same policies atomically on-chain. */
export async function nativeSpendingCapacity(input: {
  actor: string; path: Permission[]; config: TreasuryConfig; available: string; now: bigint;
  usage: (permissionId: string, scope: BudgetScope) => Promise<Usage>;
  blocked: (accountId: string) => Promise<boolean>;
  executionCount?: (permissionId: string) => Promise<number>;
}): Promise<string> {
  if (input.config.paused || input.path.length === 0 || input.path[0].delegate !== input.actor) return "0";
  let remaining = BigInt(input.available);
  for (const permission of input.path) {
    if (permission.revoked || permission.epoch !== input.config.authority_epoch || BigInt(permission.valid_from_ms) > input.now || (permission.expires_at_ms != null && BigInt(permission.expires_at_ms) <= input.now)) return "0";
    if (await input.blocked(permission.delegate) || await input.blocked(permission.issuer)) return "0";
    if (permission.max_executions != null && input.executionCount && await input.executionCount(permission.id) >= permission.max_executions) return "0";
    const rule = permission.rules.find(rule => sameAsset(rule.asset, SPENDING_ASSET));
    if (!rule) return "0";
    const scopes: { scope: BudgetScope; limit: bigint }[] = [];
    if (rule.lifetime_limit != null) scopes.push({ scope: { type: "Lifetime" }, limit: BigInt(rule.lifetime_limit) });
    if (rule.fixed_window) {
      const anchor = BigInt(rule.fixed_window.anchor_ms), duration = BigInt(rule.fixed_window.duration_ms);
      if (input.now < anchor || duration <= BigInt(0)) return "0";
      scopes.push({ scope: { type: "FixedWindow", window_index: ((input.now - anchor) / duration).toString() }, limit: BigInt(rule.fixed_window.limit) });
    }
    if (rule.streaming) {
      const elapsed = input.now > BigInt(rule.streaming.start_ms) ? (input.now - BigInt(rule.streaming.start_ms)) / BigInt(1000) : BigInt(0);
      let accrued = elapsed * BigInt(rule.streaming.rate_per_second);
      if (rule.streaming.max_cap != null && BigInt(rule.streaming.max_cap) < accrued) accrued = BigInt(rule.streaming.max_cap);
      scopes.push({ scope: { type: "Streaming" }, limit: accrued });
    }
    for (const { scope, limit } of scopes) {
      const usage = await input.usage(permission.id, scope);
      const used = BigInt(usage.settled) + BigInt(usage.pending);
      const capacity = limit > used ? limit - used : BigInt(0);
      if (capacity < remaining) remaining = capacity;
    }
  }
  return remaining.toString();
}
