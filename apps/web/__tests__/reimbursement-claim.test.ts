import { beforeEach, describe, expect, it, vi } from "vitest";
const mock = vi.hoisted(() => ({ user: vi.fn(), member: vi.fn(), program: vi.fn(), find: vi.fn(), submit: vi.fn(), reserve: vi.fn(), quote: vi.fn(), vision: vi.fn(), policy: vi.fn(), rows: [] as unknown[][] }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: async () => mock.rows.shift() ?? [] }) }) }) } }));
vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: mock.user, requireEmployeeCompany: mock.member }));
vi.mock("@/lib/session", () => ({ getSessionIdentity: async () => ({ providerUserId: "did:privy:alice", walletAddress: "a".repeat(64) }) }));
vi.mock("@/lib/reimbursements/server", () => ({ loadReimbursementProgram: mock.program }));
vi.mock("@/lib/reimbursements/payout", () => ({ findPayout: mock.find, submitPayout: mock.submit, reservePayout: mock.reserve }));
vi.mock("@/lib/reimbursement-quote", () => ({ receiptDigest: () => "b".repeat(64), verifyReceiptQuote: mock.quote }));
vi.mock("@/lib/ai", () => ({ verifyReceipt: mock.vision, checkPolicy: mock.policy }));
import { POST } from "@/app/api/agents/reimbursement/claim/route";
const employeeId = "00000000-0000-4000-8000-000000000001", companyId = "00000000-0000-4000-8000-000000000002";
const request = () => new Request("https://app.example/api/agents/reimbursement/claim", { method: "POST", body: JSON.stringify({ employeeId, companyId, claimDescription: "Client lunch", quote: "quote", receiptBase64: "aGVsbG8=" }) });
beforeEach(() => { vi.resetAllMocks(); mock.rows = []; mock.user.mockResolvedValue({ id: employeeId }); mock.member.mockResolvedValue(undefined); mock.find.mockResolvedValue(null); });
describe("NEAR reimbursement claims", () => {
  it.each(["not_configured", "pending", "paused", "unavailable", "exhausted"])("rejects %s before AI or payment", async status => {
    mock.program.mockResolvedValue({ program: { status }, agent: null, delegation: null });
    expect((await POST(request())).status).toBe(409); expect(mock.vision).not.toHaveBeenCalled(); expect(mock.submit).not.toHaveBeenCalled();
  });
  it("checks membership before accessing claim authority", async () => {
    mock.member.mockRejectedValue(new Error("Forbidden: company membership required"));
    expect((await POST(request())).status).toBe(403); expect(mock.program).not.toHaveBeenCalled();
  });
  it("reconciles the same existing job without another quote, review or reservation", async () => {
    const job = { employeeId, description: "Client lunch", id: "claim" }; mock.find.mockResolvedValue(job); mock.submit.mockResolvedValue({ claimId: "claim", state: "pending", txHash: "tx" });
    expect((await POST(request())).status).toBe(202); expect(mock.submit).toHaveBeenCalledWith(job);
    expect(mock.quote).not.toHaveBeenCalled(); expect(mock.reserve).not.toHaveBeenCalled(); expect(mock.vision).not.toHaveBeenCalled();
  });
  it("binds receipt reuse to its original employee", async () => {
    mock.find.mockResolvedValue({ employeeId: "other", description: "Client lunch" });
    expect((await POST(request())).status).toBe(409); expect(mock.submit).not.toHaveBeenCalled();
  });
  it("persists an approved NativeNear intent before calling the payout service", async () => {
    mock.program.mockResolvedValue({ program: { status: "ready", remainingAmount: "10" }, agent: { id: "agent", smartAccountAddress: "reimb.testnet" }, delegation: { id: "delegation", delegationHash: "7", policyPrompt: null }, caveats: [] });
    mock.quote.mockResolvedValue({ amountNear: "1", originalAmount: "2", currency: "USD" });
    mock.rows = [[{ smartAccountAddress: "a".repeat(64) }], [{ smartAccountAddress: "treasury.testnet", companyPolicy: "Business expenses" }]];
    mock.vision.mockResolvedValue({ verified: true }); mock.policy.mockResolvedValue({ approved: true, confidence: 0.9, reasoning: "Business expense" });
    mock.reserve.mockImplementation(async input => input); mock.submit.mockResolvedValue({ state: "paid", txHash: "tx" });
    expect((await POST(request())).status).toBe(200);
    expect(mock.reserve).toHaveBeenCalledWith(expect.objectContaining({ amountYocto: "1000000000000000000000000", recipient: "a".repeat(64), request: expect.objectContaining({ permission_id: "7", action: expect.objectContaining({ type: "Transfer", asset: { type: "NativeNear" } }) }) }));
    expect(mock.reserve.mock.invocationCallOrder[0]).toBeLessThan(mock.submit.mock.invocationCallOrder[0]);
  });
});
