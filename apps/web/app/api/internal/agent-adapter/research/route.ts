import { after } from "next/server";
import { drainQueue } from "@/lib/agent-adapter/service";
import { z } from "zod";
import { db, databaseIdentity } from "@/lib/db";
import { sql } from "drizzle-orm";
import { serviceAuthorized } from "@/lib/agent-adapter/auth";
export const runtime="nodejs";
const bodySchema=z.object({action:z.enum(["claim","complete","fail","status"]),jobId:z.string().uuid(),digest:z.string().regex(/^[a-f0-9]{64}$/),sessionId:z.string().min(1).max(300),callId:z.string().min(1).max(300),result:z.string().max(50000).optional(),message:z.string().max(300).optional()}).strict();
export async function GET(request: Request) {
 if(!serviceAuthorized(request,process.env.ALLOCARD_AGENT_SECRET)) return Response.json({error:"Unauthorized"},{status:401});
 await db.execute(sql`SELECT 1`);
 return Response.json({ready:true,protocol:"durable-direct-v1",databaseIdentity:databaseIdentity()},{headers:{"Cache-Control":"no-store"}});
}
export async function POST(request:Request){
 const headers={"Cache-Control":"no-store"};
 if(!serviceAuthorized(request,process.env.ALLOCARD_AGENT_SECRET))return Response.json({error:"Unauthorized"},{status:401,headers});
 try{
  const text=await request.text();if(text.length>60000)return Response.json({error:"Too large"},{status:413,headers});
  const body=bodySchema.parse(JSON.parse(text));
  if(body.action==="status") {
   const result=await db.execute(sql`SELECT t.state,t.result,t.message,t.started_at,c.session_id,c.call_id,c.job_id IS NOT NULL AS claimed
     FROM agent_research_tasks t LEFT JOIN agent_research_calls c ON c.job_id=t.id
     WHERE t.id=${body.jobId}::uuid AND t.digest=${body.digest} AND t.approved_at IS NOT NULL`);
   if(!result.rows[0])return Response.json({error:"Task not found"},{status:404,headers});
   return Response.json(result.rows[0],{headers});
  }
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
   if(!claimed.rows.length)return Response.json({claimed:false,cached:false},{headers});
   await db.execute(sql`UPDATE agent_research_tasks SET state='running',started_at=now(),worker_session=${body.sessionId},message='Research in progress'
     WHERE id=${body.jobId}::uuid AND state IN ('dispatching','running','needs_reconciliation')`);
   return Response.json({claimed:true,cached:false,prompt:row.prompt},{headers});
  }
  if(body.action==="fail"){
   await db.execute(sql`UPDATE agent_research_tasks SET state='failed', message=${body.message || 'Research failed. No marketplace payment was made.'} WHERE id=${body.jobId}::uuid AND digest=${body.digest} AND state IN ('dispatching','running','needs_reconciliation') AND result IS NULL AND EXISTS (SELECT 1 FROM agent_research_calls c WHERE c.job_id=${body.jobId}::uuid AND c.call_id=${body.callId} AND c.session_id=${body.sessionId})`);
   after(()=>drainQueue());
   return Response.json({saved:true},{headers});
  }
  if(!body.result)return Response.json({error:"Result required"},{status:400,headers});
  // Persist the immutable call result and visible task outcome atomically.
  // Identical callback retries acknowledge the original result without a model rerun.
  const result=await db.execute(sql`WITH saved_call AS (
    UPDATE agent_research_calls c SET result=${body.result} FROM agent_research_tasks t
    WHERE c.job_id=t.id AND t.id=${body.jobId}::uuid AND t.digest=${body.digest}
      AND c.call_id=${body.callId} AND c.session_id=${body.sessionId}
      AND (c.result IS NULL OR c.result=${body.result})
      AND t.state IN ('dispatching','running','needs_reconciliation','failed','delivered')
    RETURNING c.job_id,c.result
  ) UPDATE agent_research_tasks t SET state='delivered',result=c.result,message='Research complete'
    FROM saved_call c WHERE t.id=c.job_id RETURNING t.id`);
  after(()=>drainQueue());
  return Response.json({saved:result.rows.length>0},{headers});
 }catch{return Response.json({error:"Research call could not be authorized or persisted"},{status:503,headers});}
}
