import { after } from "next/server";
import { drainQueue } from "@/lib/agent-adapter/service";
import { z } from "zod";
import { db } from "@/lib/db";
import { sql } from "drizzle-orm";
import { serviceAuthorized } from "@/lib/agent-adapter/auth";
export const runtime="nodejs";
const bodySchema=z.object({action:z.enum(["claim","complete","fail"]),jobId:z.string().uuid(),digest:z.string().regex(/^[a-f0-9]{64}$/),sessionId:z.string().min(1).max(300),callId:z.string().min(1).max(300),result:z.string().max(50000).optional()}).strict();
export async function POST(request:Request){
 const headers={"Cache-Control":"no-store"};
 if(!serviceAuthorized(request,process.env.ALLOCARD_AGENT_SECRET))return Response.json({error:"Unauthorized"},{status:401,headers});
 try{
  const text=await request.text();if(text.length>60000)return Response.json({error:"Too large"},{status:413,headers});
  const body=bodySchema.parse(JSON.parse(text));
  if(body.action==="claim"){
   // Atomic unique claim is durable across processes. Replays may read a saved result,
   // but never reacquire permission to issue another model request.
   const claimed=await db.execute(sql`INSERT INTO agent_research_calls(job_id,call_id,session_id)
     SELECT id,${body.callId},${body.sessionId} FROM agent_research_tasks
     WHERE id=${body.jobId}::uuid AND digest=${body.digest} AND state IN ('dispatching','running','needs_reconciliation') AND approved_at IS NOT NULL
     ON CONFLICT(job_id) DO NOTHING RETURNING job_id`);
   const result=await db.execute(sql`SELECT t.prompt,c.result,c.call_id,c.session_id FROM agent_research_tasks t JOIN agent_research_calls c ON c.job_id=t.id WHERE t.id=${body.jobId}::uuid AND t.digest=${body.digest}`);
   const row=result.rows[0];
   if(!row||row.session_id!==body.sessionId||row.call_id!==body.callId)return Response.json({error:"Job is not authorized for another research call"},{status:409,headers});
   if(row.result)return Response.json({cached:true,result:row.result},{headers});
   if(!claimed.rows.length)return Response.json({error:"Original research call is already in progress or needs reconciliation"},{status:409,headers});
   return Response.json({cached:false,prompt:row.prompt},{headers});
  }
  if(body.action==="fail"){
   await db.execute(sql`UPDATE agent_research_tasks SET state='failed', message='Worker execution failed; no marketplace payment was made.' WHERE id=${body.jobId}::uuid AND digest=${body.digest} AND state IN ('dispatching','running','needs_reconciliation') AND result IS NULL`);
   after(()=>drainQueue());
   return Response.json({saved:true},{headers});
  }
  if(!body.result)return Response.json({error:"Result required"},{status:400,headers});
  const result=await db.execute(sql`UPDATE agent_research_calls c SET result=${body.result} FROM agent_research_tasks t WHERE c.job_id=t.id AND t.id=${body.jobId}::uuid AND t.digest=${body.digest} AND c.call_id=${body.callId} AND c.session_id=${body.sessionId} AND c.result IS NULL RETURNING c.job_id`);
  await db.execute(sql`UPDATE agent_research_tasks SET state='delivered',result=${body.result},message='Research complete' WHERE id=${body.jobId}::uuid AND digest=${body.digest} AND EXISTS (SELECT 1 FROM agent_research_calls c WHERE c.job_id=${body.jobId}::uuid AND c.call_id=${body.callId} AND c.session_id=${body.sessionId} AND c.result=${body.result}) AND state IN ('dispatching','running','needs_reconciliation')`);
  after(()=>drainQueue());
  return Response.json({saved:result.rows.length>0},{headers});
 }catch{return Response.json({error:"Research call could not be authorized or persisted"},{status:503,headers});}
}
