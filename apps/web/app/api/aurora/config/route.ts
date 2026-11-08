import { NextResponse } from "next/server";

export async function GET() {
  const apiKey =
    process.env.AURORA_INTENTS_API_KEY ||
    process.env.NEXT_PUBLIC_AURORA_INTENTS_API_KEY ||
    "";
  const environment =
    (process.env.AURORA_INTENTS_ENVIRONMENT as "production" | "staging") ||
    (process.env.NEXT_PUBLIC_AURORA_INTENTS_ENVIRONMENT as "production" | "staging") ||
    "production";

  return NextResponse.json({
    apiKey,
    environment,
  });
}

