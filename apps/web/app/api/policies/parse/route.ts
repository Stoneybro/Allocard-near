import { NextRequest, NextResponse } from "next/server";
import { parsePolicyWithNearAI } from "@/app/actions/policy";
export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  try {
    if (Number(req.headers.get("content-length")) > 30000) return NextResponse.json({ error: "Policy request is too large" }, { status: 413 });
    const body = await req.json();
    const { text, delegateAccount, companyId, delegationId } = body;

    if (!text || typeof text !== "string") {
      return NextResponse.json(
        { error: "Missing required string field: text" },
        { status: 400 },
      );
    }

    const result = await parsePolicyWithNearAI({
      text,
      delegateAccount,
      companyId,
      delegationId,
    });

    if (result.provider === "fallback-rules") return NextResponse.json({ error: "AI policy parsing is unavailable. Please retry shortly or configure the policy manually.", code: "AI_UNAVAILABLE" }, { status: 503 });
    return NextResponse.json(result);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("Unauthorized") || message.includes("session")) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (message.startsWith("Forbidden:")) return NextResponse.json({ error: message }, { status: 403 });
    if (message.startsWith("Enter a policy") || error instanceof SyntaxError) return NextResponse.json({ error: message || "Invalid policy request" }, { status: 400 });
    console.error("[api/policies/parse] Error:", error);
    return NextResponse.json(
      { error: "Policy review is unavailable. Try again or configure it manually." },
      { status: 500 },
    );
  }
}

