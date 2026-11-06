import { NextRequest, NextResponse } from "next/server";
import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import { parseNaturalLanguagePolicy } from "@/lib/policy-engine";

export async function POST(req: NextRequest) {
  try {
    await requireSessionUser();
    const body = await req.json();
    const { text, delegateAccount, companyId } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing required string field: text" },
        { status: 400 },
      );
    }

    let companyPolicy: string | null = null;
    if (companyId) {
      const [co] = await db
        .select({ companyPolicy: companies.companyPolicy })
        .from(companies)
        .where(eq(companies.id, companyId))
        .limit(1);
      companyPolicy = co?.companyPolicy ?? null;
    }

    const result = await parseNaturalLanguagePolicy({
      text,
      delegateAccount,
      companyId,
      companyPolicy,
    });

    return NextResponse.json(result);
  } catch (error: any) {
    if (error?.message?.includes("Unauthorized") || error?.message?.includes("session")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    console.error("[api/policies/parse] Error:", error);
    return NextResponse.json(
      { error: error?.message || "Internal server error" },
      { status: 500 },
    );
  }
}

