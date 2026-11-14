import {afterEach,beforeEach,expect,it,vi} from "vitest";
vi.mock("server-only",()=>({}));
import {workerReady} from "@/lib/agent-adapter/worker";
beforeEach(()=>{vi.stubEnv("ALLOCARD_AGENT_URL","https://worker.example");vi.stubEnv("ALLOCARD_AGENT_SECRET","s".repeat(40));vi.stubEnv("ALLOCARD_WORKER_BYPASS","preview-access");});
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
it("reports a missing Allocard worker endpoint as deployment configuration",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:true},{status:404})));await expect(workerReady()).rejects.toThrow("not deployed at its configured address");});
it("turns a worker transport timeout into an actionable error",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>{throw new DOMException("aborted","TimeoutError");}));await expect(workerReady()).rejects.toThrow("Retry to check the same task");});
it("includes both service authentication and preview protection for worker readiness",async()=>{const fetcher=vi.fn<typeof fetch>(async()=>Response.json({ready:true,mode:"direct_vercel_demo"}));vi.stubGlobal("fetch",fetcher);expect(await workerReady()).toMatchObject({ready:true});expect(fetcher.mock.calls[0][1]).toMatchObject({headers:{authorization:`Bearer ${"s".repeat(40)}`,"x-vercel-protection-bypass":"preview-access"}});});
it("returns an actionable authorization error for a protected or misconfigured worker",async()=>{vi.stubGlobal("fetch",vi.fn(async()=>Response.json({error:"Unauthorized"},{status:401})));await expect(workerReady()).rejects.toThrow("not authorized");});
it("looks up the exact durable session after the active channel address expires",async()=>{
 const {readWorker}=await import("@/lib/agent-adapter/worker");
 const fetcher=vi.fn<typeof fetch>(async()=>Response.json({state:"failed",sessionId:"wrun_original",message:"No sourced report produced"}));vi.stubGlobal("fetch",fetcher);
 await readWorker({id:"job-id",digest:"a".repeat(64),workerSession:"wrun_original"} as Parameters<typeof readWorker>[0]);
 const url=fetcher.mock.calls[0][0] as URL;
 expect(url.searchParams.get("sessionId")).toBe("wrun_original");expect(url.pathname).toBe(`/allocard/jobs/job-id/${"a".repeat(64)}`);
});
