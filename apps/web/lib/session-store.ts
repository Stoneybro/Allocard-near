import { createHash, randomBytes } from "node:crypto";
import { and, eq, gt, isNull, notExists, sql } from "drizzle-orm";
import { db } from "./db";
import { authSessions, revokedProviderSessions } from "./db/schema";

export class SessionRevokedError extends Error {}

export const SESSION_ABSOLUTE_SECONDS = 24 * 60 * 60;
export const SESSION_IDLE_SECONDS = 30 * 60;
export const validSessionToken = (value: string) => /^[A-Za-z0-9_-]{43}$/.test(value);
export const hashSessionToken = (value: string) => createHash("sha256").update(value).digest("hex");
export type StoredIdentity = { providerUserId: string; email: string; walletAddress: string };

export async function issueSession(identity: StoredIdentity, providerSessionId: string) {
  if (!providerSessionId || !identity.providerUserId.startsWith("did:privy:") || !/^[0-9a-f]{64}$/.test(identity.walletAddress)) throw new Error("Invalid verified session identity");
  const token = randomBytes(32).toString("base64url");
  const tokenHash = hashSessionToken(token);
  const providerHash = hashSessionToken(`${identity.providerUserId}\0${providerSessionId}`);
  // Separate statements share one transaction. A waiter sees the revocation
  // committed by a concurrent logout after acquiring the same provider lock.
  const result = await db.batch([
    db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${providerHash}, 0))`),
    db.execute(sql`insert into auth_sessions (token_hash, provider_session_hash, provider_user_id, wallet_address, email, expires_at)
      select ${tokenHash}, ${providerHash}, ${identity.providerUserId}, ${identity.walletAddress}, ${identity.email}, now() + interval '24 hours'
      where not exists (select 1 from revoked_provider_sessions where provider_session_hash = ${providerHash}) returning token_hash`),
  ]);
  const inserted = result[1] as { rows: unknown[] };
  if (!inserted.rows.length) throw new SessionRevokedError("This sign-in was logged out. Sign in with Privy again.");
  return token;
}

export async function readSession(token: string): Promise<StoredIdentity | null> {
  if (!validSessionToken(token)) return null;
  const revoked = db.select({ hash: revokedProviderSessions.providerSessionHash }).from(revokedProviderSessions)
    .where(eq(revokedProviderSessions.providerSessionHash, authSessions.providerSessionHash));
  const [record] = await db.update(authSessions).set({ lastSeenAt: sql`now()` }).where(and(
    eq(authSessions.tokenHash, hashSessionToken(token)), isNull(authSessions.revokedAt),
    gt(authSessions.expiresAt, sql`now()`), gt(authSessions.lastSeenAt, sql`now() - interval '30 minutes'`), notExists(revoked),
  )).returning();
  return record ? { providerUserId: record.providerUserId, walletAddress: record.walletAddress, email: record.email } : null;
}

export async function revokeSession(token: string) {
  if (!validSessionToken(token)) return;
  const [record] = await db.select().from(authSessions).where(eq(authSessions.tokenHash, hashSessionToken(token))).limit(1);
  if (!record) return;
  const providerHash = record.providerSessionHash;
  await db.batch([
    db.execute(sql`select pg_advisory_xact_lock(hashtextextended(${providerHash}, 0))`),
    db.insert(revokedProviderSessions).values({ providerSessionHash: providerHash }).onConflictDoNothing(),
    db.update(authSessions).set({ revokedAt: sql`now()` }).where(eq(authSessions.providerSessionHash, providerHash)),
  ]);
}
