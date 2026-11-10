import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import { db } from "../db";
import { agentResearchTasks as tasks } from "../db/schema";
import { ADAPTER_NAME, DEMO_LIMITS as limits, type ResearchTask } from "./shared";
export type TaskRow = typeof tasks.$inferSelect;
export const viewTask = (row: TaskRow): ResearchTask => ({ id: row.id, prompt: row.prompt, digest: row.digest, state: row.state, message: row.message, result: row.result, createdAt: row.createdAt.toISOString(), expiresAt: row.expiresAt.toISOString(), delegationId: row.delegationId, companyId: row.companyId, employeeId: row.employeeId });
export function proposalDigest(input: { companyId: string; employeeId: string; delegationId: string; prompt: string; expiresAt: string }) {
  return createHash("sha256").update(JSON.stringify({ ...input, worker: ADAPTER_NAME, mode: "direct_vercel_demo", marketplaceCharge: "0", version: 1 })).digest("hex");
}
export async function createProposal(input: { companyId: string; employeeId: string; delegationId: string; prompt: string; requestId: string }) {
  const expiresAt = new Date(Date.now() + 15 * 60_000);
  const digest = proposalDigest({ companyId: input.companyId, employeeId: input.employeeId, delegationId: input.delegationId, prompt: input.prompt, expiresAt: expiresAt.toISOString() });
  await db.insert(tasks).values({ ...input, digest, expiresAt }).onConflictDoNothing();
  const [row] = await db.select().from(tasks).where(and(eq(tasks.employeeId, input.employeeId), eq(tasks.requestId, input.requestId))).limit(1);
  if (!row || row.prompt !== input.prompt || row.companyId !== input.companyId || row.delegationId !== input.delegationId) throw new Error("Idempotency conflict: this request ID belongs to another proposal");
  return row;
}
export async function ownTask(id: string, employeeId: string) {
  const [row] = await db.select().from(tasks).where(and(eq(tasks.id, id), eq(tasks.employeeId, employeeId))).limit(1);
  if (!row) throw new Error("Forbidden: research task not found"); return row;
}
export async function listTasks(employeeId: string, companyId: string, delegationId?: string) {
  return db.select().from(tasks).where(and(eq(tasks.employeeId, employeeId), eq(tasks.companyId, companyId), delegationId ? eq(tasks.delegationId, delegationId) : undefined)).orderBy(desc(tasks.createdAt)).limit(25);
}
export async function confirmProposal(row: TaskRow, digest: string) {
  if (row.digest !== digest) throw new Error("Proposal changed. Review it again.");
  if (row.state !== "proposal") return row;
  if (row.expiresAt.getTime() <= Date.now()) throw new Error("Proposal expired. Prepare a new request.");
  // All quota checks and the admission transition share a cross-process transaction lock.
  const results = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(1095519312)`),
    db.execute(sql`UPDATE agent_research_tasks SET state='queued', approved_at=now(), expires_at=now()+interval '10 minutes', reserved_micros=${limits.reserveMicros}
      WHERE id=${row.id}::uuid AND employee_id=${row.employeeId}::uuid AND state='proposal' AND digest=${digest} AND expires_at>now()
      AND (SELECT count(*) FROM agent_research_tasks WHERE approved_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') < ${limits.dailyGlobal}
      AND (SELECT count(*) FROM agent_research_tasks WHERE employee_id=${row.employeeId}::uuid AND approved_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') < ${limits.dailyEmployee}
      AND (SELECT count(*) FROM agent_research_tasks WHERE state='queued') < ${limits.queue}
      AND (SELECT coalesce(sum(reserved_micros),0) FROM agent_research_tasks WHERE approved_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC') + ${limits.reserveMicros} <= ${limits.dailyMicros}
      RETURNING id`),
  ]);
  if (!results[1].rows.length) throw new Error("Research capacity or daily usage budget reached. Try later.");
  return ownTask(row.id, row.employeeId);
}
export async function claimTask(row: TaskRow) {
  const results = await db.batch([
    db.execute(sql`SELECT pg_advisory_xact_lock(1095519312)`),
    db.execute(sql`UPDATE agent_research_tasks SET state='dispatching', started_at=now(), message='Connecting to research worker'
      WHERE id=${row.id}::uuid AND state='queued' AND expires_at>now()
      AND (SELECT count(*) FROM agent_research_tasks WHERE state IN ('dispatching','running','needs_reconciliation')) < ${limits.concurrentGlobal}
      AND (SELECT count(*) FROM agent_research_tasks WHERE employee_id=${row.employeeId}::uuid AND state IN ('dispatching','running','needs_reconciliation')) < ${limits.concurrentEmployee}
      AND NOT EXISTS (SELECT 1 FROM agent_research_tasks ahead WHERE ahead.state='queued' AND ahead.created_at<${row.createdAt} AND ahead.employee_id=${row.employeeId}::uuid)
      RETURNING id`),
  ]);
  return results[1].rows.length > 0;
}
export async function updateTask(id: string, values: Partial<typeof tasks.$inferInsert>, states: string[]) {
  await db.update(tasks).set(values).where(and(eq(tasks.id, id), sql`${tasks.state} IN (${sql.join(states.map(state => sql`${state}`), sql`, `)})`));
}

export async function companyTasks(companyId: string, delegationId?: string) {
  return db.select().from(tasks).where(and(eq(tasks.companyId, companyId), delegationId ? eq(tasks.delegationId, delegationId) : undefined)).orderBy(desc(tasks.createdAt)).limit(50);
}
