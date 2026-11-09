import { createHash, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { agentResearchTasks as tasks, users } from "@/lib/db/schema";
import { asc, eq, inArray } from "drizzle-orm";
import { progressTask } from "@/lib/agent-adapter/service";
export const runtime="nodejs";
export const maxDuration=60;
export async function GET(request:Request){
 const secret=process.env.CRON_SECRET;
 const hash=(value:string)=>createHash("sha256").update(value).digest();
 if(!secret||secret.length<32||!timingSafeEqual(hash(request.headers.get("authorization")||""),hash(`Bearer ${secret}`)))return Response.json({error:"Unauthorized"},{status:401});
 const rows=await db.select({task:tasks, user:users}).from(tasks).innerJoin(users,eq(users.id,tasks.employeeId)).where(inArray(tasks.state,["queued","dispatching","running","needs_reconciliation"])).orderBy(asc(tasks.createdAt)).limit(12);
 const result=await Promise.allSettled(rows.map(({task,user})=>progressTask(task,user.nearAccountId??user.embeddedWalletAddress)));
 return Response.json({checked:result.length,errors:result.filter(item=>item.status==="rejected").length},{headers:{"Cache-Control":"no-store"}});
}
