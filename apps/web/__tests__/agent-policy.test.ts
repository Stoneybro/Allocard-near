import { expect, it } from "vitest";
import { buildAgentPolicySpec, resolveAgentPolicyForm, agentFormFromPermission } from "@/lib/agent-policy";
import { buildPolicySpec, emptyCaveatForm } from "@/lib/policy-configuration";
import { SPENDING_DECIMALS } from "@/lib/chain";
import { parseTokenAmount } from "@allocard/delegation-sdk";
const now = Date.parse("2026-11-12T12:00:00Z");
const parent = buildPolicySpec({ ...emptyCaveatForm, maxAmountNear: "100", period: "weekly", periodAmountNear: "50", perTransactionCapNear: "10", allowedTargets: "vendor.testnet", expiresAt: "2099-01-01T00:00:00Z", limitedCallsEnabled: true, limitedCalls: "20" }, "employee.testnet", now);
it("signs the agent's selected recurring window and retains independent employer restrictions", () => {
  const form = { ...emptyCaveatForm, maxAmountNear: "30", period: "daily" as const, periodAmountNear: "5", perTransactionCapNear: "2" };
  const spec = buildAgentPolicySpec(form, "agent.testnet", parent, now);
  expect(spec.rules[0].fixed_window).toEqual({ duration_ms: "86400000", anchor_ms: String(now), limit: parseTokenAmount("5", SPENDING_DECIMALS) });
  expect(parent.rules[0].fixed_window?.duration_ms).toBe("604800000");
  expect(spec).toMatchObject({ redelegation_depth: 0, expires_at_ms: parent.expires_at_ms, max_executions: 20 });
  expect(spec.rules[0].recipients).toEqual(parent.rules[0].recipients);
  expect(agentFormFromPermission(spec)).toMatchObject({ period: "daily", periodAmountNear: "5", perTransactionCapNear: "2" });
});
it("makes inherited bounds explicit and rejects wider recipients, caps and expiry", () => {
  const form = { ...emptyCaveatForm, maxAmountNear: "30" };
  expect(resolveAgentPolicyForm(form, parent)).toMatchObject({ perTransactionCapNear: "10", allowedTargets: "vendor.testnet", limitedCalls: "20" });
  expect(() => buildAgentPolicySpec({ ...form, allowedTargets: "attacker.testnet" }, "agent.testnet", parent, now)).toThrow("recipients");
  expect(() => buildAgentPolicySpec({ ...form, perTransactionCapNear: "11" }, "agent.testnet", parent, now)).toThrow("cap");
  expect(() => buildAgentPolicySpec({ ...form, expiresAt: "2100-01-01T00:00:00Z" }, "agent.testnet", parent, now)).toThrow("outlast");
});
