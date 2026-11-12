import type { PermissionSpec } from "@allocard/delegation-sdk";
import { formatTokenAmount, parseTokenAmount } from "@allocard/delegation-sdk";
import { SPENDING_ASSET, SPENDING_DECIMALS, sameAsset } from "./chain";
import { buildPolicySpec, emptyCaveatForm, periodDurations, splitAddresses, type CaveatForm } from "./policy-configuration";

export function agentFormFromPermission(spec: PermissionSpec, policyPrompt = ""): CaveatForm {
  const rule = spec.rules.find(rule => sameAsset(rule.asset, SPENDING_ASSET));
  if (!rule) throw new Error("This agent policy has no supported spending asset.");
  const period = Object.entries(periodDurations).find(([, seconds]) => String(seconds * 1000) === rule.fixed_window?.duration_ms)?.[0] as CaveatForm["period"] | undefined;
  return { ...emptyCaveatForm, policyPrompt,
    maxAmountNear: rule.lifetime_limit ? formatTokenAmount(rule.lifetime_limit, SPENDING_DECIMALS) : "",
    perTransactionCapNear: rule.max_per_action ? formatTokenAmount(rule.max_per_action, SPENDING_DECIMALS) : "",
    period: period || "none", periodAmountNear: rule.fixed_window ? formatTokenAmount(rule.fixed_window.limit, SPENDING_DECIMALS) : "",
    allowedTargets: rule.recipients.type === "Only" ? rule.recipients.accounts.join(", ") : "",
    limitedCallsEnabled: spec.max_executions != null, limitedCalls: String(spec.max_executions ?? 1),
    expiresAt: spec.expires_at_ms ? new Date(Number(spec.expires_at_ms)).toISOString() : "",
  };
}

/** Omitted child bounds inherit mandatory parent bounds and are visible in review. */
export function resolveAgentPolicyForm(form: CaveatForm, parent: PermissionSpec): CaveatForm {
  const rule = parent.rules.find(rule => sameAsset(rule.asset, SPENDING_ASSET));
  if (!rule) throw new Error("Your employer's spending policy is unavailable. Refresh and retry.");
  let inheritedCap = rule.max_per_action;
  if (inheritedCap) {
    try {
      const ceiling = parseTokenAmount(form.period !== "none" && form.periodAmountNear ? form.periodAmountNear : form.maxAmountNear, SPENDING_DECIMALS);
      if (BigInt(ceiling) < BigInt(inheritedCap)) inheritedCap = ceiling;
    } catch { /* Normal field validation explains an incomplete amount. */ }
  }
  return { ...form,
    perTransactionCapNear: form.perTransactionCapNear || (inheritedCap ? formatTokenAmount(inheritedCap, SPENDING_DECIMALS) : ""),
    allowedTargets: form.allowedTargets.trim() || (rule.recipients.type === "Only" ? rule.recipients.accounts.join(", ") : ""),
    expiresAt: form.expiresAt || (parent.expires_at_ms ? new Date(Number(parent.expires_at_ms)).toISOString() : ""),
    limitedCallsEnabled: form.limitedCallsEnabled || parent.max_executions != null,
    limitedCalls: form.limitedCallsEnabled ? form.limitedCalls : String(parent.max_executions ?? 1),
  };
}

export function buildAgentPolicySpec(form: CaveatForm, delegate: string, parent: PermissionSpec, now = Date.now()): PermissionSpec {
  if (parent.redelegation_depth < 1) throw new Error("Your employer has not allowed agent access.");
  const resolved = resolveAgentPolicyForm(form, parent);
  const spec = buildPolicySpec(resolved, delegate, now);
  const rule = spec.rules[0];
  const parentRule = parent.rules.find(rule => sameAsset(rule.asset, SPENDING_ASSET))!;
  if (parentRule.lifetime_limit && BigInt(rule.lifetime_limit!) > BigInt(parentRule.lifetime_limit)) throw new Error("The agent budget cannot exceed your employer's total budget.");
  if (parentRule.max_per_action && BigInt(rule.max_per_action!) > BigInt(parentRule.max_per_action)) throw new Error("The payment cap cannot exceed your employer's cap.");
  const recipients = parentRule.recipients;
  if (recipients.type === "Only" && splitAddresses(resolved.allowedTargets).some(account => !recipients.accounts.includes(account))) throw new Error("Choose recipients allowed by your employer.");
  if (parent.expires_at_ms && BigInt(spec.expires_at_ms!) > BigInt(parent.expires_at_ms)) throw new Error("Agent access cannot outlast your employer's allowance.");
  if (parent.max_executions != null && spec.max_executions! > parent.max_executions) throw new Error("The payment count cannot exceed your employer's limit.");
  return { ...spec, valid_from_ms: String(Math.max(now, Number(parent.valid_from_ms))), redelegation_depth: 0,
    rules: [{ ...rule, min_per_action: parentRule.min_per_action }],
  };
}
