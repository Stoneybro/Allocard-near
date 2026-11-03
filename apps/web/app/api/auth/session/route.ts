import { databaseFailure } from "@/lib/db/error";
import { sameSiteOrigin } from "@/lib/request-origin";
import { and, eq, or } from "drizzle-orm";
import { users } from "@/lib/db/schema";
import { verifyPrivySession } from "@/lib/privy-server";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { consumedLoginNonces } from "@/lib/db/schema";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { clearSession, createNearSession, getSessionIdentity } from "@/lib/session";
import { sessionSecret } from "@/lib/session-secret";
import { verifyLoginProof, type LoginChallenge, type WalletProof } from "@/lib/near-proof";
import { nearQuery } from "@/lib/near-server";
const headers = { "Cache-Control": "no-store, private" };
export async function GET() {
  const identity = await getSessionIdentity();
  return Response.json(identity, { status: identity ? 200 : 401, headers });
}
export async function POST(request: Request) {
  if (!sameSiteOrigin(request)) return Response.json({ error: "Wrong origin" }, { status: 403, headers });
  try {
    const body = await request.json();
    if (typeof body.accessToken === "string" && typeof body.accountId === "string") {
      const verified = await verifyPrivySession(body.accessToken, body.accountId);
      const [existing] = await db.select().from(users).where(or(eq(users.privyUserId, verified.providerUserId), eq(users.nearAccountId, verified.walletAddress))).limit(1);
      if (existing) {
        if (existing.privyUserId !== verified.providerUserId || (existing.nearAccountId && existing.nearAccountId !== verified.walletAddress)) throw new Error("Complete verified account linking before changing your NEAR signing wallet");
        await db.update(users).set({ nearAccountId: verified.walletAddress, verifiedEmail: verified.email }).where(eq(users.id, existing.id));
      }
      return Response.json(await createNearSession(verified.walletAddress, verified), { headers });
    }
    const proof = body as WalletProof;
    const store = await cookies();
    const token = store.get("allocard_login_challenge")?.value;
    store.delete("allocard_login_challenge");
    if (!token) throw new Error("Request a fresh sign-in challenge");
    const { payload } = await jwtVerify(token, sessionSecret(), { audience: "allocard-login", algorithms: ["HS256"] });
    const challenge = payload as unknown as LoginChallenge;
    if (challenge.recipient !== sameSiteOrigin(request)) throw new Error("Wrong sign-in domain");
    verifyLoginProof(challenge, proof);
    const accessKey = await nearQuery({ request_type: "view_access_key", account_id: proof.accountId, public_key: proof.publicKey });
    if (accessKey.permission !== "FullAccess") throw new Error("Use a wallet account key with full access to prove account ownership");
    const nonceHash = createHash("sha256").update(JSON.stringify(challenge)).digest("hex");
    const consumed = await db.insert(consumedLoginNonces).values({ nonceHash, expiresAt: new Date(Number(payload.exp) * 1000) })
      .onConflictDoNothing().returning({ nonceHash: consumedLoginNonces.nonceHash });
    if (!consumed.length) throw new Error("This sign-in challenge has already been used. Sign again with a fresh challenge.");
    return Response.json(await createNearSession(proof.accountId), { headers });
  } catch (error) {
    const databaseError = databaseFailure(error);
    if (databaseError) return Response.json({ error: databaseError }, { status: 503, headers });
    return Response.json({ error: error instanceof Error ? error.message : "Sign-in verification failed" }, { status: 401, headers });
  }
}
export async function DELETE(request: Request) {
  if (!sameSiteOrigin(request)) return Response.json({ error: "Wrong origin" }, { status: 403 });
  await clearSession(); return new Response(null, { status: 204, headers });
}
