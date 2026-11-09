import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { requireSessionUser, requireEmployeeCompany } from "@/lib/auth-guard";
import { sameSiteOrigin } from "@/lib/request-origin";
import { taskInput, confirmInput } from "@/lib/agent-adapter/shared";
import { authorizeAdapter } from "@/lib/agent-adapter/permissions";
import { discoverWorkers } from "@/lib/agent-adapter/catalog";
import { companyTasks, createProposal, confirmProposal, ownTask, listTasks, viewTask } from "@/lib/agent-adapter/store";
import { progressTask, cancelQueued } from "@/lib/agent-adapter/service";
import { workerReady } from "@/lib/agent-adapter/worker";
export const runtime="nodejs";
const headers={"Cache-Control":"no-store, private"};
function failure(error: unknown) {
  const message=error instanceof z.ZodError ? "Invalid research request" : error instanceof Error ? error.message : "Research service unavailable";
  const status=message.startsWith("Unauthorized:")?401:message.startsWith("Forbidden:")?403:error instanceof z.ZodError?400:/expired|changed|conflict|capacity|budget|cancel/i.test(message)?409:503;
  return Response.json({error:message},{status,headers});
}
export async function GET(request: Request) {
  try {
    const user=await requireSessionUser(); const url=new URL(request.url);
    const companyId=z.string().uuid().parse(url.searchParams.get("companyId"));
    if(url.searchParams.get("view")==="company") {
      const [company]=await db.select({id:companies.id}).from(companies).where(and(eq(companies.id,companyId),eq(companies.ownerId,user.id))).limit(1);
      if(!company)throw new Error("Forbidden: only this company owner may read research activity");
      return Response.json((await companyTasks(companyId)).map(viewTask),{headers});
    }
    await requireEmployeeCompany(user.id,companyId);
    const id=url.searchParams.get("id");
    if (id) { const row=await ownTask(z.string().uuid().parse(id),user.id); if(row.companyId!==companyId) throw new Error("Forbidden: another workspace"); return Response.json(viewTask(row),{headers}); }
    const query=url.searchParams.get("q");
    if(query) return Response.json({agents:await discoverWorkers(z.string().min(2).max(200).parse(query))},{headers});
    return Response.json((await listTasks(user.id,companyId)).map(viewTask),{headers});
  } catch(error) { return failure(error); }
}
export async function POST(request: Request) {
  if(!sameSiteOrigin(request)) return Response.json({error:"Wrong origin"},{status:403,headers});
  try {
    const user=await requireSessionUser(); const text=await request.text(); if(text.length>8192) return Response.json({error:"Request too large"},{status:413,headers});
    const input=JSON.parse(text); const action=z.enum(["prepare","confirm","progress","cancel"]).parse(input.action);
    if(action==="prepare") {
      const parsed=taskInput.parse(input.task); await authorizeAdapter(user.id,user.embeddedWalletAddress,parsed.companyId,parsed.delegationId);
      // Validate deployment without invoking the model or creating a marketplace job.
      await workerReady();
      return Response.json(viewTask(await createProposal({...parsed,employeeId:user.id})),{headers});
    }
    const {id,digest}=confirmInput.parse(input.task); let row=await ownTask(id,user.id); await requireEmployeeCompany(user.id,row.companyId);
    if(row.digest!==digest) throw new Error("Proposal changed. Review it again.");
    if(action==="cancel") return Response.json(viewTask(await cancelQueued(row)),{headers});
    if(action==="confirm") { await authorizeAdapter(user.id,user.embeddedWalletAddress,row.companyId,row.delegationId); row=await confirmProposal(row,digest); }
    return Response.json(viewTask(await progressTask(row,user.embeddedWalletAddress)),{headers});
  } catch(error) { return failure(error); }
}
