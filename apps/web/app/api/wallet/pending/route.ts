import { requireSessionUser, requireEmployeeCompany } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { treasuryReader, finalizedTimestamp } from "@/lib/near-server";
export async function POST(request: Request) {
  try {
    const user = await requireSessionUser();
    const { companyId, requestId, deadlineMs } = await request.json();
    if (typeof companyId !== "string" || !/^[0-9a-f]{64}$/.test(requestId) || !/^[0-9]+$/.test(deadlineMs)) throw new Error("Invalid pending request");
    await requireEmployeeCompany(user.id, companyId);
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company?.smartAccountAddress) throw new Error("Company treasury unavailable");
    // Read the finalized clock first, then the immutable replay record. A new
    // dispatch cannot pass its deadline after the finalized chain has passed it.
    const finalized = await finalizedTimestamp();
    const execution = await treasuryReader(company.smartAccountAddress).getExecutionByRequest(user.embeddedWalletAddress, requestId);
    return Response.json({ execution, canDiscard: !execution && finalized >= BigInt(deadlineMs) }, { headers: { "Cache-Control": "no-store" } });
  } catch (caught) { return Response.json({ error: caught instanceof Error ? caught.message : "Could not reconcile payment" }, { status: 409 }); }
}
