import { describe, expect, it } from "vitest";
import { buildPolicySpec, emptyCaveatForm, hasFormErrors, validateCaveatForm, type CaveatForm } from "@/lib/policy-configuration";
import { SPENDING_DECIMALS, TOKEN_SYMBOL } from "@/lib/chain";
import { parseTokenAmount } from "@allocard/delegation-sdk";
import { reviewParsedPolicy } from "@/lib/policy-review";
import { parsePolicyDeterministicFallback, type ParsedPolicyResult } from "@/lib/policy-engine";

const now = Date.parse("2026-11-12T12:00:00Z");
const form: CaveatForm = { ...emptyCaveatForm, maxAmountNear: "50", period: "weekly", periodAmountNear: "10", perTransactionCapNear: "5", allowedTargets: "vendor.testnet\nsupplier.testnet", limitedCallsEnabled: true, limitedCalls: "20", expiresAt: "2026-12-12T12:00:00Z" };
describe("employee policy validation", () => {
  it("creates the exact reviewed permission across all supported restrictions", () => {
    expect(hasFormErrors(validateCaveatForm(form, "100", now))).toBe(false);
    const spec = buildPolicySpec(form, "employee.testnet", now);
    expect(spec).toMatchObject({ delegate: "employee.testnet", max_executions: 20, expires_at_ms: String(Date.parse(form.expiresAt)), redelegation_depth: 1 });
    expect(spec.rules[0]).toMatchObject({ lifetime_limit: parseTokenAmount("50", SPENDING_DECIMALS), max_per_action: parseTokenAmount("5", SPENDING_DECIMALS), recipients: { type: "Only", accounts: ["vendor.testnet", "supplier.testnet"] }, fixed_window: { limit: parseTokenAmount("10", SPENDING_DECIMALS), duration_ms: "604800000", anchor_ms: String(now) }, approval: null });
  });
  it.each(["01", " 1e3 ", "0", "-1", `0.${"1".repeat(SPENDING_DECIMALS + 1)}`, "9999999999999999999999999999999999999999999999999"])("reports %s inline rather than throwing", maxAmountNear => {
    expect(() => validateCaveatForm({ ...form, maxAmountNear }, "100", now)).not.toThrow();
    expect(validateCaveatForm({ ...form, maxAmountNear }, "100", now).maxAmountNear).toBeTruthy();
  });
  it("rejects conflicting limits, insufficient funds, unsafe counts, duplicates, and past expiry", () => {
    expect(validateCaveatForm({ ...form, periodAmountNear: "51" }, null, now).periodAmountNear).toBeTruthy();
    expect(validateCaveatForm({ ...form, perTransactionCapNear: "11" }, null, now).perTransactionCapNear).toBeTruthy();
    expect(validateCaveatForm(form, "49", now).maxAmountNear).toContain("49");
    expect(validateCaveatForm({ ...form, limitedCalls: "9007199254740992" }, null, now).limitedCalls).toBeTruthy();
    expect(validateCaveatForm({ ...form, allowedTargets: "vendor.testnet,vendor.testnet" }, null, now).allowedTargets).toContain("duplicate");
    expect(validateCaveatForm({ ...form, expiresAt: "2026-01-01" }, null, now).expiresAt).toBeTruthy();
    expect(validateCaveatForm({ ...form, expiresAt: "2026-01-01" }, null, now, true).expiresAt).toBeUndefined();
  });
  it("uses exact base units for differences invisible to floating point", () => {
    const maxAmountNear = `1.${"0".repeat(SPENDING_DECIMALS - 1)}1`;
    const periodAmountNear = `1.${"0".repeat(SPENDING_DECIMALS - 1)}2`;
    expect(validateCaveatForm({ ...form, maxAmountNear, periodAmountNear }, null, now).periodAmountNear).toBeTruthy();
  });
});

const parsed = (): ParsedPolicyResult => {
  const result = parsePolicyDeterministicFallback({ text: "total 50 NEAR", delegateAccount: "employee.testnet" });
  return { ...result, success: true, provider: "near-ai", confidence: 0.95, warnings: [], semanticGuardrails: "", formValues: { ...result.formValues, ...form, expiresAt: new Date(Date.now() + 86400000).toISOString() }, onChainSpec: buildPolicySpec({ ...form, expiresAt: "" }, "employee.testnet") };
};
describe("AI policy review gate", () => {
  it("blocks gibberish, low confidence, missing totals, fallback, and dropped rules", () => {
    expect(reviewParsedPolicy({ ...parsed(), confidence: 0.2 }).success).toBe(false);
    expect(reviewParsedPolicy({ ...parsed(), provider: "fallback-rules" }).success).toBe(false);
    const missing = parsed(); missing.formValues.maxAmountNear = "";
    expect(reviewParsedPolicy(missing).success).toBe(false);
    expect(reviewParsedPolicy({ ...parsed(), clarificationQuestions: ["What does 'a little' mean?"] }).clarificationQuestions).toContain("What does 'a little' mean?");
    expect(reviewParsedPolicy({ ...parsed(), warnings: ["Target omitted: invalid account"] }).success).toBe(false);
  });
  it("blocks approval rules instead of dropping them during signing", () => {
    const result = parsed(); result.onChainSpec.rules[0].approval = { approver: "finance.testnet", above_amount: "1" };
    expect(reviewParsedPolicy(result).success).toBe(false);
  });
  it("rejects overlapping recurring limits while recognizing equivalent wording", () => {
    expect(reviewParsedPolicy({ ...parsed(), rawInput: "Total 50. Allow 10 per week and 5 daily." }).success).toBe(false);
    expect(reviewParsedPolicy({ ...parsed(), rawInput: "Total 50. A weekly budget of 10 per week." }).success).toBe(true);
  });
  it("rejects other monetary currencies without confusing NEAR account terminology", () => {
    const other = TOKEN_SYMBOL === "NEAR" ? "USDC" : "NEAR";
    expect(reviewParsedPolicy({ ...parsed(), rawInput: `Give 50 ${other} total` }).success).toBe(false);
    expect(reviewParsedPolicy({ ...parsed(), rawInput: `Give 50 ${TOKEN_SYMBOL} total for payments to NEAR accounts` }).success).toBe(true);
  });
  it("retains explicit advisory warnings for qualitative instructions", () => {
    const result = reviewParsedPolicy({ ...parsed(), semanticGuardrails: "Business travel only" });
    expect(result.success).toBe(true);
    expect(result.warnings.join(" ")).toContain("not enforced");
  });
});
