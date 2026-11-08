import { databaseFailure } from "@/lib/db/error";
import { withRetry } from "@/lib/db/withRetry";
import { sameSiteOrigin } from "@/lib/request-origin";
import { eq, or } from "drizzle-orm";
import { db } from "@/lib/db";
import { users } from "@/lib/db/schema";
import { PrivySessionError, verifyPrivySession } from "@/lib/privy-server";
import { clearSession, createNearSession, getSessionIdentity } from "@/lib/session";
import { SessionRevokedError } from "@/lib/session-store";
import { z } from "zod";
const sessionRequest = z.object({ accessToken: z.string().min(1).max(16384), accountId: z.string().regex(/^[0-9a-f]{64}$/) });
const headers = { "Cache-Control": "no-store, private" };
export async function GET() {
  try {
    const identity = await getSessionIdentity();
    return Response.json(identity, { status: identity ? 200 : 401, headers });
  } catch { return Response.json({ error: "Session service is temporarily unavailable" }, { status: 503, headers }); }
}
export async function POST(request: Request) {
  if (!sameSiteOrigin(request)) return Response.json({ error: "Wrong origin" }, { status: 403, headers });
  try {
    const parsed = sessionRequest.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return Response.json({ error: "Sign in with email or Google through Privy.", code: "INVALID_REQUEST" }, { status: 400, headers });
    const body = parsed.data;
    const verified = await verifyPrivySession(body.accessToken, body.accountId);
    const [existing] = await withRetry(
      () => db.select().from(users).where(or(eq(users.privyUserId, verified.providerUserId), eq(users.nearAccountId, verified.walletAddress))).limit(1),
      "auth:lookup-user"
    );
    if (existing) {
      if (existing.privyUserId !== verified.providerUserId || (existing.nearAccountId && existing.nearAccountId !== verified.walletAddress)) throw new Error("Complete verified account linking before changing your NEAR signing wallet");
      await withRetry(
        () => db.update(users).set({ nearAccountId: verified.walletAddress, verifiedEmail: verified.email }).where(eq(users.id, existing.id)),
        "auth:update-user"
      );
    }
    return Response.json(await createNearSession(verified.walletAddress, verified), { headers });

  } catch (error) {
    if (error instanceof SessionRevokedError) return Response.json({ error: error.message, code: "SESSION_REVOKED" }, { status: 403, headers });
    if (error instanceof PrivySessionError) {
      console.warn("[POST /api/auth/session]", { code: error.code, status: error.status });
      return Response.json({ error: error.message, code: error.code }, {
        status: error.status, headers: { ...headers, ...(error.status === 503 ? { "Retry-After": "1" } : {}) },
      });
    }
    console.error("[POST /api/auth/session]", error);
    const databaseError = databaseFailure(error);
    if (databaseError) return Response.json({ error: databaseError }, { status: 503, headers });
    return Response.json({ error: error instanceof Error ? error.message : "Sign-in verification failed" }, { status: 401, headers });
  }
}
export async function DELETE(request: Request) {
  if (!sameSiteOrigin(request)) return Response.json({ error: "Wrong origin" }, { status: 403 });
  try { await clearSession(); return new Response(null, { status: 204, headers }); }
  catch { return Response.json({ error: "Could not revoke your session. Please retry sign-out." }, { status: 503, headers }); }
}
