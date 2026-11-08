import { z } from "zod";
import { requireSessionUser, requireEmployeeCompany } from "@/lib/auth-guard";
import { findPayout, reconcilePayout } from "@/lib/reimbursements/payout";
export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const { claimId } = z.object({ claimId: z.string().regex(/^[0-9a-f]{64}$/) }).parse(await request.json());
    const job = await findPayout(claimId);
    if (!job || job.employeeId !== user.id) return Response.json({ error: "Claim not found" }, { status: 404 });
    await requireEmployeeCompany(user.id, job.companyId);
    return Response.json(await reconcilePayout(job), { headers: { "Cache-Control": "no-store" } });
  } catch (caught) {
    const message = caught instanceof Error ? caught.message : "Claim status is unavailable";
    const status = message.startsWith("Unauthorized:") ? 401 : message.startsWith("Forbidden:") ? 403 : caught instanceof z.ZodError ? 400 : 503;
    return Response.json({ error: status === 503 ? "Claim status is unavailable. Retry the same claim later." : message }, { status });
  }
}
