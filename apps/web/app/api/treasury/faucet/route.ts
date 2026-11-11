import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { verifyTreasuryOwner } from "@/lib/near-server";
import { fundMockUsdcTreasury } from "@/lib/near-sponsor-server";
import { sameSiteOrigin } from "@/lib/request-origin";

export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store, private" };
const claimInput = z.object({ companyId: z.uuid(), claimId: z.uuid() }).strict();

export async function POST(request: Request) {
  if (!sameSiteOrigin(request)) {
    return Response.json({ error: "Wrong origin" }, { status: 403, headers });
  }
  try {
    const user = await requireSessionUser();
    const body = await request.text();
    if (body.length > 1024) return Response.json({ error: "Invalid faucet claim" }, { status: 400, headers });
    const { companyId, claimId } = claimInput.parse(JSON.parse(body));
    const [company] = await db.select().from(companies)
      .where(and(eq(companies.id, companyId), eq(companies.ownerId, user.id))).limit(1);
    if (!company?.smartAccountAddress) {
      return Response.json({ error: "An activated company treasury owned by you is required" }, { status: 403, headers });
    }
    await verifyTreasuryOwner(company.smartAccountAddress, user.embeddedWalletAddress);
    const result = await fundMockUsdcTreasury({
      owner: user.embeddedWalletAddress,
      companyId,
      treasury: company.smartAccountAddress,
      claimId,
    });
    return Response.json(result, { headers });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Faucet claim could not be confirmed";
    const status = error instanceof SyntaxError || error instanceof z.ZodError ? 400
      : message.startsWith("Unauthorized:") ? 401
        : message.startsWith("Forbidden:") ? 403 : 503;
    return Response.json({ error: status === 400 ? "Invalid faucet claim" : message }, { status, headers });
  }
}
