import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), membership: vi.fn(), rows: [] as unknown[], queue: null as unknown[][] | null, where: vi.fn(), ai: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: mocks.user, requireEmployeeCompany: mocks.membership }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: (condition: unknown) => { mocks.where(condition); return { limit: async () => mocks.queue ? mocks.queue.shift() ?? [] : mocks.rows }; } }) }) } }));
vi.mock("@/lib/ai", () => ({ aiChat: mocks.ai, getTextModel: () => "model", getApiKey: () => "configured" }));
import { parsePolicyWithNearAI } from "@/app/actions/policy";
import { PgDialect } from "drizzle-orm/pg-core";
import { TOKEN_SYMBOL } from "@/lib/chain";
const input = { text: `A total budget of 50 ${TOKEN_SYMBOL}.`, delegateAccount: "employee.testnet", companyId: "12345678-1234-4234-8234-123456789012" };
beforeEach(() => {
  vi.clearAllMocks(); mocks.queue = null; mocks.membership.mockResolvedValue(undefined); mocks.user.mockResolvedValue({ id: "owner-id" }); mocks.rows = [{ companyPolicy: null }];
  mocks.ai.mockResolvedValue({ confidence: 0.95, lifetimeLimitNear: "50", period: "none", warnings: [], semanticGuardrails: "", clarificationQuestions: [] });
});
it("allows an employee to parse only their own agent policy under an active company allowance", async () => {
  mocks.queue = [[{ parentDelegationId: "parent", delegateeId: "agent" }], [{ signedDelegation: { rules: [] } }], [{ smartAccountAddress: "agent.testnet" }], [{ companyPolicy: null }]];
  const result = await parsePolicyWithNearAI({ ...input, delegateAccount: "agent.testnet", delegationId: "22345678-1234-4234-8234-123456789012" });
  expect(result.success).toBe(true);
  expect(mocks.membership).toHaveBeenCalledWith("owner-id", input.companyId);
  expect(mocks.ai).toHaveBeenCalledTimes(1);
  expect(mocks.ai.mock.calls[0][0]).toMatchObject({ disableThinking: true, timeoutMs: 35000 });
  const childQuery = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
  expect(childQuery.params).toContain("owner-id");
  expect(childQuery.params).toContain("pending_config");
});
it("rejects a spoofed agent target before sending company policy to AI", async () => {
  mocks.queue = [[{ parentDelegationId: "parent", delegateeId: "agent" }], [{ signedDelegation: {} }], [{ smartAccountAddress: "other.testnet" }], [{ companyPolicy: "private" }]];
  await expect(parsePolicyWithNearAI({ ...input, delegationId: "22345678-1234-4234-8234-123456789012" })).rejects.toThrow("Forbidden");
  expect(mocks.ai).not.toHaveBeenCalled();
});
it("authorizes the company owner before reading company policy or calling AI", async () => {
  mocks.rows = [];
  await expect(parsePolicyWithNearAI(input)).rejects.toThrow("Forbidden");
  expect(mocks.ai).not.toHaveBeenCalled();
  const query = new PgDialect().sqlToQuery(mocks.where.mock.calls[0][0]);
  expect(query.sql).toContain('"owner_id"');
  expect(query.params).toContain("owner-id");
});
it("rejects oversized prompts and invalid accounts before calling AI", async () => {
  await expect(parsePolicyWithNearAI({ ...input, text: "x".repeat(6001) })).rejects.toThrow("6,000");
  await expect(parsePolicyWithNearAI({ ...input, delegateAccount: "invalid account" })).rejects.toThrow("valid employee");
  expect(mocks.ai).not.toHaveBeenCalled();
});
it("asks for clarification on unintelligible input and malformed model output", async () => {
  mocks.ai.mockResolvedValueOnce({ confidence: 0.1, lifetimeLimitNear: null, clarificationQuestions: ["What total budget do you want to authorize?"] });
  const result = await parsePolicyWithNearAI({ ...input, text: "blah purple bananas" });
  expect(result.success).toBe(false);
  expect(result.clarificationQuestions).toContain("What total budget do you want to authorize?");
  mocks.ai.mockResolvedValueOnce({ confidence: "high", allowedTargets: 42 });
  const malformed = await parsePolicyWithNearAI(input);
  expect(malformed.success).toBe(false);
  expect(malformed.clarificationQuestions?.join(" ")).toContain("manual configuration");
});
it("blocks clashing AI budgets even if the model claims high confidence", async () => {
  mocks.ai.mockResolvedValueOnce({ confidence: 1, lifetimeLimitNear: "50", period: "weekly", periodLimitNear: "100" });
  const result = await parsePolicyWithNearAI(input);
  expect(result.success).toBe(false);
  expect(result.clarificationQuestions?.join(" ")).toContain("exceed");
});
it("blocks silently omitted expiration, count, and approval requests", async () => {
  const result = await parsePolicyWithNearAI({ ...input, text: `${input.text} Expire in 7 days. Limit to 2 payments. Require approval from finance.testnet.` });
  expect(result.success).toBe(false);
  expect(result.clarificationQuestions?.join(" ")).toContain("expiration");
  expect(result.clarificationQuestions?.join(" ")).toContain("transaction count");
  expect(result.clarificationQuestions?.join(" ")).toContain("Approval");
});
it("returns all supported restrictions for a clear demo policy", async () => {
  mocks.ai.mockResolvedValueOnce({ confidence: 0.98, lifetimeLimitNear: "50", period: "weekly", periodLimitNear: "10", perTransactionCapNear: "5", allowedTargets: ["vendor.testnet"], maxExecutions: 20, expiresInDays: 30 });
  const result = await parsePolicyWithNearAI(input);
  expect(result.success).toBe(true);
  expect(result.formValues).toMatchObject({ maxAmountNear: "50", period: "weekly", periodAmountNear: "10", perTransactionCapNear: "5", allowedTargets: "vendor.testnet", limitedCallsEnabled: true, limitedCalls: "20" });
  expect(result.formValues.expiresAt).toBeTruthy();
});
