import { describe, expect, it, vi, afterEach } from "vitest";
import {
  parsePolicyDeterministicFallback,
  validatePermissionSpec,
  specToCaveatFormValues,
  isValidNearAccountId,
  parseNaturalLanguagePolicy,
  synthesizeCompanyPolicy,
  PERIOD_DURATIONS_MS,
} from "../lib/policy-engine";
import { parseTokenAmount } from "@allocard/delegation-sdk";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("isValidNearAccountId", () => {
  it("accepts valid named NEAR accounts", () => {
    expect(isValidNearAccountId("alex.near")).toBe(true);
    expect(isValidNearAccountId("bob.testnet")).toBe(true);
    expect(isValidNearAccountId("sub.domain.testnet")).toBe(true);
    expect(isValidNearAccountId("my-org_team.near")).toBe(true);
    expect(isValidNearAccountId("ab")).toBe(true);
  });

  it("accepts valid 64-char implicit hex accounts", () => {
    const implicit = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";
    expect(isValidNearAccountId(implicit)).toBe(true);
  });

  it("rejects invalid accounts", () => {
    expect(isValidNearAccountId("")).toBe(false);
    expect(isValidNearAccountId("a")).toBe(false); // too short
    expect(isValidNearAccountId("A".repeat(65))).toBe(false); // too long
    expect(isValidNearAccountId("UPPERCASE.near")).toBe(false); // uppercase
    expect(isValidNearAccountId("invalid@near")).toBe(false); // illegal character
    expect(isValidNearAccountId("has spaces.near")).toBe(false);
  });
});

describe("Deterministic Fallback Policy Parser", () => {
  const fixedNow = 1_700_000_000_000;

  it("extracts lifetime limit and per-transaction cap", () => {
    const text = "Give Alice a total budget of 100 NEAR with a max of 20 NEAR per transaction.";
    const result = parsePolicyDeterministicFallback({
      text,
      delegateAccount: "alice.testnet",
      nowMs: fixedNow,
    });

    expect(result.formValues.maxAmountNear).toBe("100");
    expect(result.formValues.perTransactionCapNear).toBe("20");
    expect(result.onChainSpec.delegate).toBe("alice.testnet");

    const rule = result.onChainSpec.rules[0];
    expect(rule.lifetime_limit).toBe(parseTokenAmount("100", 24));
    expect(rule.max_per_action).toBe(parseTokenAmount("20", 24));
    expect(result.provider).toBe("fallback-rules");
  });

  it("extracts recurring monthly allowance and duration", () => {
    const text = "Allow 50 NEAR per month for hosting services.";
    const result = parsePolicyDeterministicFallback({
      text,
      delegateAccount: "dev.testnet",
      nowMs: fixedNow,
    });

    expect(result.formValues.period).toBe("monthly");
    expect(result.formValues.periodAmountNear).toBe("50");

    const rule = result.onChainSpec.rules[0];
    expect(rule.fixed_window).toBeDefined();
    expect(rule.fixed_window?.limit).toBe(parseTokenAmount("50", 24));
    expect(rule.fixed_window?.duration_ms).toBe(PERIOD_DURATIONS_MS.monthly.toString());
  });

  it("extracts approval requirements and approver account", () => {
    const text = "Allow up to 80 NEAR total. Require approval from finance.near for payments above 25 NEAR.";
    const result = parsePolicyDeterministicFallback({
      text,
      delegateAccount: "employee.testnet",
      nowMs: fixedNow,
    });

    expect(result.formValues.approvalEnabled).toBe(true);
    expect(result.formValues.approvalApprover).toBe("finance.near");
    expect(result.formValues.approvalAboveAmountNear).toBe("25");

    const rule = result.onChainSpec.rules[0];
    expect(rule.approval).toBeDefined();
    expect(rule.approval?.approver).toBe("finance.near");
    expect(rule.approval?.above_amount).toBe(parseTokenAmount("25", 24));
  });

  it("uses explicit accounts and never invents merchant destinations", () => {
    const text = "Permit spending on chainstack and ack3, or payments to vendor.testnet.";
    const result = parsePolicyDeterministicFallback({
      text,
      delegateAccount: "eng.testnet",
      nowMs: fixedNow,
    });

    const rule = result.onChainSpec.rules[0];
    expect(rule.recipients.type).toBe("Only");
    if (rule.recipients.type === "Only") {
      expect(rule.recipients.accounts).not.toContain("chainstack.testnet");
      expect(rule.recipients.accounts).not.toContain("ack3.testnet");
      expect(rule.recipients.accounts).toContain("vendor.testnet");
    }
  });

  it("extracts transaction execution limits and expiration duration", () => {
    const text = "Limit to 10 transactions. Valid for 60 days.";
    const result = parsePolicyDeterministicFallback({
      text,
      delegateAccount: "contractor.testnet",
      nowMs: fixedNow,
    });

    expect(result.onChainSpec.max_executions).toBe(10);
    const expectedExp = fixedNow + 60 * 86400 * 1000;
    expect(result.onChainSpec.expires_at_ms).toBe(expectedExp.toString());
  });

  it("handles unbounded budgets correctly with acknowledge_unbounded_budget", () => {
    const text = "Allow legitimate software purchases as needed with no spending cap.";
    const result = parsePolicyDeterministicFallback({
      text,
      delegateAccount: "lead.testnet",
      nowMs: fixedNow,
    });

    const rule = result.onChainSpec.rules[0];
    expect(rule.lifetime_limit).toBeNull();
    expect(rule.fixed_window).toBeNull();
    expect(rule.acknowledge_unbounded_budget).toBe(true);
  });
});

describe("validatePermissionSpec (Smart Contract Rules)", () => {
  const nowMs = 1_700_000_000_000;

  it("validates a fully compliant PermissionSpec", () => {
    const spec = {
      delegate: "alex.testnet",
      valid_from_ms: nowMs.toString(),
      expires_at_ms: (nowMs + 100000).toString(),
      max_executions: 5,
      rules: [
        {
          asset: { type: "NativeNear" as const },
          recipients: { type: "Any" as const },
          min_per_action: null,
          max_per_action: parseTokenAmount("10", 24),
          lifetime_limit: parseTokenAmount("50", 24),
          fixed_window: null,
          streaming: null,
          approval: { approver: "treasury.testnet", above_amount: parseTokenAmount("5", 24) },
          acknowledge_unbounded_budget: false,
        },
      ],
      redelegation_depth: 1,
      metadata_hash: null,
    };

    const res = validatePermissionSpec(spec);
    expect(res.valid).toBe(true);
    expect(res.errors).toHaveLength(0);
  });

  it("rejects invalid delegate account", () => {
    const spec = {
      delegate: "INVALID@ACCOUNT",
      valid_from_ms: nowMs.toString(),
      expires_at_ms: null,
      max_executions: null,
      rules: [
        {
          asset: { type: "NativeNear" as const },
          recipients: { type: "Any" as const },
          min_per_action: null,
          max_per_action: null,
          lifetime_limit: parseTokenAmount("50", 24),
          fixed_window: null,
          streaming: null,
          approval: null,
          acknowledge_unbounded_budget: false,
        },
      ],
      redelegation_depth: 1,
      metadata_hash: null,
    };

    const res = validatePermissionSpec(spec);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("Invalid delegate account"))).toBe(true);
  });

  it("rejects expiration timestamps before or equal to valid_from_ms", () => {
    const spec = {
      delegate: "bob.testnet",
      valid_from_ms: "5000",
      expires_at_ms: "5000", // not strictly after
      max_executions: null,
      rules: [
        {
          asset: { type: "NativeNear" as const },
          recipients: { type: "Any" as const },
          min_per_action: null,
          max_per_action: null,
          lifetime_limit: parseTokenAmount("50", 24),
          fixed_window: null,
          streaming: null,
          approval: null,
          acknowledge_unbounded_budget: false,
        },
      ],
      redelegation_depth: 1,
      metadata_hash: null,
    };

    const res = validatePermissionSpec(spec);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("expires_at_ms must be strictly after valid_from_ms"))).toBe(true);
  });

  it("rejects unbounded budget if acknowledge_unbounded_budget is false", () => {
    const spec = {
      delegate: "bob.testnet",
      valid_from_ms: "5000",
      expires_at_ms: null,
      max_executions: null,
      rules: [
        {
          asset: { type: "NativeNear" as const },
          recipients: { type: "Any" as const },
          min_per_action: null,
          max_per_action: null,
          lifetime_limit: null,
          fixed_window: null,
          streaming: null,
          approval: null,
          acknowledge_unbounded_budget: false, // violates contract requirement
        },
      ],
      redelegation_depth: 1,
      metadata_hash: null,
    };

    const res = validatePermissionSpec(spec);
    expect(res.valid).toBe(false);
    expect(res.errors.some((e) => e.includes("acknowledge_unbounded_budget is false"))).toBe(true);
  });
});

describe("specToCaveatFormValues", () => {
  it("formats yoctoNEAR values back to decimal NEAR for UI form inputs", () => {
    const spec = {
      delegate: "sam.testnet",
      valid_from_ms: "1000",
      expires_at_ms: null,
      max_executions: 3,
      rules: [
        {
          asset: { type: "NativeNear" as const },
          recipients: { type: "Only" as const, accounts: ["v1.near", "v2.near"] },
          min_per_action: null,
          max_per_action: parseTokenAmount("7.5", 24),
          lifetime_limit: parseTokenAmount("250", 24),
          fixed_window: {
            limit: parseTokenAmount("50", 24),
            duration_ms: PERIOD_DURATIONS_MS.monthly.toString(),
            anchor_ms: "1000",
          },
          streaming: null,
          approval: {
            approver: "lead.near",
            above_amount: parseTokenAmount("15", 24),
          },
          acknowledge_unbounded_budget: false,
        },
      ],
      redelegation_depth: 1,
      metadata_hash: null,
    };

    const form = specToCaveatFormValues(spec, "Custom guardrail");
    expect(form.maxAmountNear).toBe("250");
    expect(form.perTransactionCapNear).toBe("7.5");
    expect(form.period).toBe("monthly");
    expect(form.periodAmountNear).toBe("50");
    expect(form.allowedTargets).toBe("v1.near, v2.near");
    expect(form.approvalEnabled).toBe(true);
    expect(form.approvalApprover).toBe("lead.near");
    expect(form.approvalAboveAmountNear).toBe("15");
    expect(form.limitedCalls).toBe("3");
    expect(form.policyPrompt).toBe("Custom guardrail");
  });
});

describe("NEAR AI Cloud Integration", () => {
  it("calls NEAR AI endpoint when NEAR_AI_API_KEY is configured", async () => {
    vi.stubEnv("NEAR_AI_API_KEY", "test-near-key");
    const mockAiResponse = {
      summary: "AI generated policy allowing 45 NEAR monthly for RPC providers.",
      reasoning: "Allocated 45 NEAR to chainstack and crouton.",
      confidence: 0.95,
      lifetimeLimitNear: "150",
      period: "monthly",
      periodLimitNear: "45",
      perTransactionCapNear: "15",
      allowedTargets: ["chainstack.testnet", "crouton.testnet"],
      approval: { approver: "audit.testnet", aboveAmountNear: "10" },
      maxExecutions: 20,
      semanticGuardrails: "RPC endpoints and streaming only.",
      warnings: [],
    };

    const mockFetch = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: JSON.stringify(mockAiResponse) } }],
        }),
        { status: 200 },
      ),
    );
    vi.stubGlobal("fetch", mockFetch);

    const result = await parseNaturalLanguagePolicy({
      text: "Allow 45 NEAR per month for Chainstack and Crouton RPCs with audit.testnet sign-off over 10 NEAR.",
      delegateAccount: "node-runner.testnet",
    });

    expect(mockFetch).toHaveBeenCalledTimes(1);
    const fetchArgs = mockFetch.mock.calls[0];
    expect(fetchArgs[0]).toContain("https://api.near.ai/v1/chat/completions");
    expect(fetchArgs[1].headers.Authorization).toBe("Bearer test-near-key");

    expect(result.provider).toBe("near-ai");
    expect(result.formValues.period).toBe("monthly");
    expect(result.formValues.periodAmountNear).toBe("45");
    expect(result.formValues.maxAmountNear).toBe("150");
    expect(result.formValues.allowedTargets).toContain("chainstack.testnet");
    expect(result.formValues.approvalApprover).toBe("audit.testnet");
    expect(result.confidence).toBe(0.95);
  });

  it("gracefully falls back when NEAR AI is rate-limited", async () => {
    vi.stubEnv("NEAR_AI_API_KEY", "test-near-key");
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(new Response("Rate limited", { status: 429 })),
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});

    const result = await parseNaturalLanguagePolicy({
      text: "Allow 30 NEAR per month for AWS hosting.",
      delegateAccount: "cloud.testnet",
    });

    expect(result.provider).toBe("fallback-rules");
    expect(result.formValues.period).toBe("monthly");
    expect(result.formValues.periodAmountNear).toBe("30");
    expect(result.success).toBe(true);
  });
});

describe("synthesizeCompanyPolicy", () => {
  it("synthesizes company policy with NEAR AI when key is present", async () => {
    vi.stubEnv("NEAR_AI_API_KEY", "test-near-key");
    const mockAiResponse = {
      policy: "Allowed: Cloud hosting, developer tools.\nProhibited: Luxury goods, gaming.",
      summary: "Developer focused startup policy.",
    };

    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            choices: [{ message: { content: JSON.stringify(mockAiResponse) } }],
          }),
          { status: 200 },
        ),
      ),
    );

    const result = await synthesizeCompanyPolicy({
      prompt: "Only developer tools and cloud hosting, no personal spending",
      companyName: "Web3 Labs",
    });

    expect(result.policy).toContain("Allowed: Cloud hosting");
    expect(result.summary).toContain("Developer focused");
  });

  it("returns formatted fallback when API key is missing", async () => {
    const result = await synthesizeCompanyPolicy({
      prompt: "Only allow developer subscriptions",
    });

    expect(result.policy).toContain("Allowed:");
    expect(result.policy).toContain("Only allow developer subscriptions");
  });
});

