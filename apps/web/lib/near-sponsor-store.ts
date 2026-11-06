import { and, eq, isNull, lt, sql } from "drizzle-orm";
import { db } from "./db";
import { nearSponsorJobs as jobs, nearSponsorKeys as keys, nearSponsorLimits as limits } from "./db/schema";
import { withRetry } from "./db/withRetry";
export type SponsorJob = typeof jobs.$inferSelect;

export async function findSponsorJob(id: string) {
  return (await withRetry(() => db.select().from(jobs).where(eq(jobs.id, id)).limit(1), "sponsor:lookup"))[0] ?? null;
}
export async function claimSponsorJob(input: Pick<SponsorJob, "id" | "actor" | "intentHash" | "relayerId">) {
  // Do not retry mutations after an ambiguous database response.
  return (await db.insert(jobs).values(input).onConflictDoNothing().returning())[0] ?? null;
}
export async function takeSponsorQuota(actor: string, globalLimit: number, userLimit: number) {
  const day = new Date().toISOString().slice(0, 10);
  for (const [bucket, max] of [[`wallet:${actor}:${day}`, userLimit], [`global:${day}`, globalLimit]] as const) {
    const rows = await db.insert(limits).values({ bucket, used: "1" }).onConflictDoUpdate({
      target: limits.bucket, set: { used: sql`${limits.used} + 1` }, setWhere: lt(limits.used, String(max)),
    }).returning({ bucket: limits.bucket });
    if (!rows.length) throw new Error("Daily gas sponsorship limit reached. Retry tomorrow or use a funded NEAR wallet.");
  }
}
export async function acquireSponsorKey(key: string) {
  // Database time prevents clock skew between serverless instances from stealing a lease.
  const rows = await db.insert(keys).values({ key, nonce: "0", leaseUntil: sql`date_trunc('milliseconds', now()) + interval '180 seconds'` }).onConflictDoUpdate({
    target: keys.key, set: { leaseUntil: sql`date_trunc('milliseconds', now()) + interval '180 seconds'` }, setWhere: sql`${keys.leaseUntil} < now()`,
  }).returning();
  if (!rows.length) throw new Error("The gas sponsor is processing another transaction. Retry this payment shortly.");
  return rows[0];
}
export async function allocateSponsorNonce(key: string, chainNextNonce: string, leaseUntil: Date) {
  const [row] = await db.update(keys).set({ nonce: sql`greatest(${keys.nonce} + 1, ${chainNextNonce}::numeric)` }).where(and(eq(keys.key, key), eq(keys.leaseUntil, leaseUntil), sql`${keys.leaseUntil} > now()`)).returning();
  if (!row) throw new Error("Gas sponsor nonce reservation failed");
  return row.nonce;
}
export async function releaseSponsorKey(key: string, leaseUntil: Date) {
  await db.update(keys).set({ leaseUntil: sql`now()` }).where(and(eq(keys.key, key), eq(keys.leaseUntil, leaseUntil)));
}
export async function saveSponsorTransaction(id: string, transactionHash: string, signedTransaction: string) {
  const rows = await db.update(jobs).set({ transactionHash, signedTransaction, state: "submitted" }).where(and(eq(jobs.id, id), eq(jobs.state, "reserved"))).returning({ id: jobs.id });
  if (!rows.length) throw new Error("Sponsorship reservation was lost; no transaction was submitted");
}
export async function finishSponsorJob(id: string, state: "confirmed" | "failed") {
  await db.update(jobs).set({ state }).where(eq(jobs.id, id));
}

export async function releaseUnbroadcastJob(id: string) {
  await db.delete(jobs).where(and(eq(jobs.id, id), eq(jobs.state, "reserved"), isNull(jobs.transactionHash)));
}
