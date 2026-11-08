import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { parseTokenAmount, type ExecuteRequest } from "@allocard/delegation-sdk";
import { db } from "@/lib/db";
import { employeeProfiles, companies } from "@/lib/db/schema";
import { requireEmployeeCompany, requireSessionUser } from "@/lib/auth-guard";
import { getSessionIdentity } from "@/lib/session";
import { loadReimbursementProgram } from "@/lib/reimbursements/server";
import { reimbursementEmployeeMessage } from "@/lib/reimbursements/shared";
import { findPayout, reservePayout, submitPayout } from "@/lib/reimbursements/payout";
import { receiptDigest, verifyReceiptQuote } from "@/lib/reimbursement-quote";
import { checkPolicy, verifyReceipt } from "@/lib/ai";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const parsed = z.object({ companyId: z.string().uuid(), employeeId: z.string().uuid(), claimDescription: z.string().trim().min(1).max(4000), quote: z.string().max(8192), receiptBase64: z.string().min(1).max(12_000_000) }).safeParse(await request.json());
    if (!parsed.success) return Response.json({ error: "Provide a company, receipt, business purpose and current conversion quote." }, { status: 400 });
    const input = parsed.data;
    if (input.employeeId !== user.id) return Response.json({ error: "You can only submit your own claims" }, { status: 403 });
    await requireEmployeeCompany(user.id, input.companyId);
    const receiptHash = receiptDigest(input.receiptBase64);
    const claimId = hash(`${input.companyId}\0${receiptHash}`);
    // Reconcile the original job even if its quote or permission later expired.
    const existing = await findPayout(claimId);
    if (existing) {
      if (existing.employeeId !== user.id || existing.description !== input.claimDescription) return Response.json({ error: "This receipt has already been claimed with different details" }, { status: 409 });
      const result = await submitPayout(existing);
      return Response.json({ ...result, aiApproved: result.state === "paid" }, { status: result.state === "pending" ? 202 : 200 });
    }
    const current = await loadReimbursementProgram(input.companyId);
    if (current.program.status !== "ready" || !current.agent || !current.delegation?.delegationHash) return Response.json({ code: "REIMBURSEMENT_NOT_READY", error: reimbursementEmployeeMessage(current.program.status) }, { status: 409 });
    const identity = await getSessionIdentity();
    if (!identity) return Response.json({ error: "Sign in again to continue" }, { status: 401 });
    let quote;
    try { quote = await verifyReceiptQuote(input.quote, receiptHash, identity.providerUserId); }
    catch { return Response.json({ code: "QUOTE_EXPIRED", error: "Extract the receipt again to obtain a current verified conversion quote." }, { status: 409 }); }
    const amount = parseTokenAmount(quote.amountNear, 24);
    if (current.program.remainingAmount === null || BigInt(amount) > BigInt(parseTokenAmount(current.program.remainingAmount, 24))) return Response.json({ error: "Claim exceeds the verified remaining reimbursement capacity" }, { status: 409 });
    const [employee] = await db.select().from(employeeProfiles).where(and(eq(employeeProfiles.userId, user.id), eq(employeeProfiles.companyId, input.companyId))).limit(1);
    const [company] = await db.select().from(companies).where(eq(companies.id, input.companyId)).limit(1);
    if (employee?.smartAccountAddress !== identity.walletAddress || !company?.smartAccountAddress) return Response.json({ error: "Activate your verified NEAR payout account first" }, { status: 409 });
    const vision = await verifyReceipt({ imageBase64: input.receiptBase64, claimDescription: input.claimDescription, amountNear: quote.amountNear, receiptAmount: quote.originalAmount, currency: quote.currency });
    if (!vision.verified) return Response.json({ aiApproved: false, aiReasoning: vision.reasoning });
    const policy = await checkPolicy({ claimDescription: input.claimDescription, amountNear: quote.amountNear, caveats: current.caveats.map(c => ({ ...c, createdAt: c.createdAt.toISOString() })), policyPrompt: current.delegation.policyPrompt, companyPolicy: company.companyPolicy });
    if (!policy.approved || policy.confidence < 0.8) return Response.json({ aiApproved: false, aiReasoning: policy.reasoning });
    const requestBody: ExecuteRequest = { api_version: 1, request_id: claimId, permission_id: current.delegation.delegationHash, action: { type: "Transfer", asset: { type: "NativeNear" }, receiver: identity.walletAddress, amount }, deadline_ms: String(Date.now() + 15 * 60_000) };
    const job = await reservePayout({ id: claimId, intentHash: hash(JSON.stringify([input.companyId, user.id, identity.walletAddress, amount, input.claimDescription])), companyId: input.companyId, employeeId: user.id, agentId: current.agent.id, delegationId: current.delegation.id, treasury: company.smartAccountAddress, actor: current.agent.smartAccountAddress, recipient: identity.walletAddress, amountYocto: amount, description: input.claimDescription, request: requestBody, state: "approved", review: policy, leaseToken: randomUUID(), leaseUntil: new Date(0) });
    const result = await submitPayout(job);
    return Response.json({ ...result, aiApproved: result.state === "paid", aiReasoning: policy.reasoning }, { status: result.state === "pending" ? 202 : 200 });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Claim could not be processed";
    const status = message.startsWith("Unauthorized:") ? 401 : message.startsWith("Forbidden:") ? 403 : 503;
    return Response.json({ error: status === 503 ? "Claim processing is temporarily unavailable. Retry this same receipt to reconcile its payment." : message }, { status });
  }
}
