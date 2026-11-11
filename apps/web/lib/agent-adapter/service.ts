import "server-only";
import { db } from "../db";
import { and, asc, eq, sql } from "drizzle-orm";
import { agentResearchTasks as tasks, users } from "../db/schema";
import { authorizeAdapter } from "./permissions";
import { claimTask, ownTask, updateTask, type TaskRow } from "./store";
import { dispatchWorker, readWorker } from "./worker";
export async function progressTask(row: TaskRow, wallet: string) {
  if (row.state === "queued") {
    if (row.expiresAt.getTime() <= Date.now()) { await updateTask(row.id,{ state:"expired", message:"Queue deadline passed; prepare a new request.", reservedMicros:"0" },["queued"]); return ownTask(row.id,row.employeeId); }
    try { await authorizeAdapter(row.employeeId,wallet,row.companyId,row.delegationId); }
    catch (error) { if (error instanceof Error && error.message.startsWith("Forbidden:")) await updateTask(row.id,{state:"failed",message:"Delegated access is no longer valid.",reservedMicros:"0"},["queued"]); else throw error; return ownTask(row.id,row.employeeId); }
    if (await claimTask(row)) {
      try { const status=await dispatchWorker(row); await updateTask(row.id,{state:status.state,result:status.result??null,message:status.message??"Research in progress",workerSession:status.sessionId},["dispatching"]); }
      catch { await updateTask(row.id,{state:"needs_reconciliation",message:"Worker submission was not confirmed. Checking the original job; no replacement will be started."},["dispatching"]); }
    }
  } else if (["dispatching","running","needs_reconciliation"].includes(row.state)) {
    try {
      const status=await readWorker(row);
      if (status?.retryable) {
        await authorizeAdapter(row.employeeId,wallet,row.companyId,row.delegationId);
        const resumed = await dispatchWorker(row);
        await updateTask(row.id,{state:resumed.state,result:resumed.result??null,message:resumed.message??null,workerSession:resumed.sessionId},["dispatching","running","needs_reconciliation"]);
        return ownTask(row.id,row.employeeId);
      }
      if (status) await updateTask(row.id,{state:status.state,result:status.result??null,message:status.message??null,workerSession:status.sessionId},["dispatching","running","needs_reconciliation"]);
      // Never free a potentially live reservation just because an HTTP read failed.
      if (!status && row.startedAt && Date.now()-row.startedAt.getTime()>240000) await updateTask(row.id,{state:"needs_reconciliation",message:"No worker record found. An operator must reconcile this request before another run."},["dispatching","running"]);
    } catch { /* Preserve durable state; the next status request may recover. */ }
  }
  return ownTask(row.id,row.employeeId);
}
export async function cancelQueued(row: TaskRow) {
  await db.update(tasks).set({state:"cancelled",message:"Cancelled before dispatch",reservedMicros:"0"}).where(and(eq(tasks.id,row.id),eq(tasks.employeeId,row.employeeId),sql`${tasks.state} IN ('proposal','queued')`));
  const current=await ownTask(row.id,row.employeeId);
  if (!["cancelled","expired"].includes(current.state)) throw new Error("This job may already be running. Cancellation cannot be guaranteed.");
  return current;
}

/** Request-driven dispatch: completion callbacks and active clients advance durable jobs. */
export async function drainQueue() {
  const rows=await db.select({task:tasks,user:users}).from(tasks).innerJoin(users,eq(users.id,tasks.employeeId)).where(eq(tasks.state,"queued")).orderBy(asc(tasks.createdAt)).limit(12);
  await Promise.allSettled(rows.map(({task,user})=>progressTask(task,user.nearAccountId??user.embeddedWalletAddress)));
}
