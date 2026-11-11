import { afterEach, describe, expect, it, vi } from "vitest";
import { readLiveNativeCapacity, capacityReadError } from "@/lib/live-capacity";
import { treasuryReader, nearQuery } from "@/lib/near-server";
import { NearReadError } from "@/lib/near-read-error";
const company="a".repeat(64);
const permission={id:"1",parent_id:null,issuer:"owner.testnet",delegate:"employee.testnet",epoch:"1",depth:0,valid_from_ms:"0",expires_at_ms:null,max_executions:10,revoked:false,rules:[{asset:{type:"NativeNear"},recipients:{type:"Any"},lifetime_limit:"1000",acknowledge_unbounded_budget:false}],redelegation_depth:0,metadata_hash:null};
afterEach(()=>vi.unstubAllGlobals());
function healthyRpc(failMethod?:string) {
 const counts:Record<string,number>={};
 const fetcher=vi.fn(async(_url:unknown,options:RequestInit)=>{
  const params=JSON.parse(String(options.body)).params;
  expect(params.account_id).toBe("shared.testnet");
  const args=JSON.parse(Buffer.from(params.args_base64,"base64").toString());
  expect(args.company_id).toBe(company);
  const method=params.method_name;
  counts[method]=(counts[method]||0)+1;
  if(method===failMethod) return Response.json({error:{message:"Server error",data:"GuestPanic: ALLOCARD_PERMISSION_NOT_FOUND"}});
  const result=method==="get_permission_path"?[permission]:method==="get_config"?{paused:false,authority_epoch:"1"}:method==="get_asset_ledger"?{available:"10000",pending_outgoing:"0",enabled:true}:method==="is_principal_blocked"?false:method==="get_permission_usage"?{executions_count:0}:{settled:"100",pending:"50"};
  return Response.json({result:{result:[...Buffer.from(JSON.stringify(result))]}});
 });
 vi.stubGlobal("fetch",fetcher);return counts;
}
describe("live employee capacity from a shared treasury",()=>{
 it("uses one bounded snapshot after config on the reservation release",async()=>{
  const methods:string[]=[];
  vi.stubGlobal("fetch",vi.fn(async(_url,options)=>{
   const method=JSON.parse(options.body).params.method_name;methods.push(method);
   const value=method==="get_config"?{schema_version:5}:method==="get_spending_snapshot"?{approved:"1000",allocated:"300",spent:"100",remaining:"600",timestamp_ms:"1000"}:null;
   return Response.json({result:{result:[...Buffer.from(JSON.stringify(value))]}});
  }));
  const value=await readLiveNativeCapacity(treasuryReader(`shared.testnet#${company}`),"employee.testnet","1");
  expect(methods).toEqual(["get_config","get_spending_snapshot"]);
  expect(value.reservationsSupported).toBe(true);
  expect(value.remainingNear).toBe("0.0000000000000000000006");
 });
 it("verifies scoped policies and reuses lifetime usage for the dashboard totals",async()=>{
  const counts=healthyRpc();
  const result=await readLiveNativeCapacity(treasuryReader(`shared.testnet#${company}`),"employee.testnet","1");
  expect(result.remainingNear).toBe("0.00000000000000000000085");
  expect(counts.get_usage).toBe(1);
  expect(counts.is_principal_blocked).toBe(2);
 });
 it("identifies the failed method and contract code while keeping capacity unverified",async()=>{
  healthyRpc("get_permission_path");
  let caught:unknown;
  try{await readLiveNativeCapacity(treasuryReader(`shared.testnet#${company}`),"employee.testnet","1");}catch(error){caught=error;}
  const message=capacityReadError(caught);
  expect(message).toContain("get_permission_path");
  expect(message).toContain("ALLOCARD_PERMISSION_NOT_FOUND");
  expect(message).toContain("Payments remain disabled");
 });
 it("retries transport failures, then returns a specific read error",async()=>{
  const fetcher=vi.fn(async()=>{throw new Error("fetch failed: https://provider.example/secret");});vi.stubGlobal("fetch",fetcher);
  await expect(nearQuery({request_type:"call_function",account_id:"shared.testnet",method_name:"get_config"})).rejects.toThrow("get_config");
  expect(fetcher).toHaveBeenCalledTimes(2);
 });
 it("does not expose arbitrary provider errors as employee messages",()=>{
  expect(capacityReadError(new Error("private-provider-key"))).not.toContain("private-provider-key");
  expect(capacityReadError(new NearReadError("get_usage","RATE_LIMITED","RPC rate limited"))).toContain("get_usage");
 });
});
it("backs off before retrying a rate-limited RPC read",async()=>{
 vi.useFakeTimers();
 try {
  const fetcher=vi.fn().mockResolvedValueOnce(new Response(null,{status:429,headers:{"Retry-After":"1"}})).mockResolvedValueOnce(Response.json({result:{result:[49]}}));
  vi.stubGlobal("fetch",fetcher);
  const result=nearQuery({request_type:"call_function",account_id:"shared.testnet",method_name:"get_config"});
  await vi.advanceTimersByTimeAsync(0);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(999);
  expect(fetcher).toHaveBeenCalledTimes(1);
  await vi.advanceTimersByTimeAsync(1);
  expect(await result).toEqual({result:[49]});
  expect(fetcher).toHaveBeenCalledTimes(2);
 } finally { vi.useRealTimers(); }
});
