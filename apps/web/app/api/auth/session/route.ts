import { NextResponse } from "next/server";
import { clearSession, createNearSession } from "@/lib/session";

const NO_STORE = { "Cache-Control": "no-store, private" };

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/json")) {
    return NextResponse.json({ error: "Expected a JSON request" }, { status: 415, headers: NO_STORE });
  }

  const body = (await request.json().catch(() => null)) as {
    accountId?: unknown;
    accessToken?: unknown;
    email?: unknown;
  } | null;

  const targetId =
    typeof body?.accountId === "string" && body.accountId.length > 0
      ? body.accountId
      : typeof body?.accessToken === "string" && body.accessToken.length > 0
        ? body.accessToken
        : null;

  if (!targetId || targetId.length > 8192) {
    return NextResponse.json({ error: "A valid accountId or sign-in token is required" }, { status: 400, headers: NO_STORE });
  }

  try {
    const email = typeof body?.email === "string" ? body.email : null;
    const identity = await createNearSession(targetId, email);
    return NextResponse.json(identity, { headers: NO_STORE });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Sign-in could not be verified";
    return NextResponse.json({ error: message }, { status: 401, headers: NO_STORE });
  }
}

export async function DELETE() {
  await clearSession();
  return new Response(null, { status: 204, headers: NO_STORE });
}
