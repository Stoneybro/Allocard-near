import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { coordinatedNearRead, invalidateNearReadCache, backoffNearRead, waitForRpcCooldown } from "@/lib/near-read-coordinator";
const params={request_type:"call_function",account_id:"shared.testnet",method_name:"get_usage",args_base64:"e30="};
beforeEach(()=>invalidateNearReadCache());
afterEach(()=>vi.useRealTimers());
describe("RPC read pressure",()=>{
 it("coalesces concurrent advisory reads",async()=>{
  let complete!:(value:unknown)=>void;
  const run=vi.fn(()=>new Promise(resolve=>{complete=resolve;}));
  const first=coordinatedNearRead("rpc-a",params,run,2000);
  const second=coordinatedNearRead("rpc-a",params,run,2000);
  complete({available:"10"});
  expect(await first).toEqual({available:"10"});
  expect(await second).toEqual({available:"10"});
  expect(run).toHaveBeenCalledTimes(1);
 });
 it("expires advisory snapshots and never uses them for authoritative reads",async()=>{
  vi.useFakeTimers();
  const run=vi.fn(async()=>({available:"10"}));
  await coordinatedNearRead("rpc-b",params,run,2000);
  await coordinatedNearRead("rpc-b",params,run,2000);
  expect(run).toHaveBeenCalledTimes(1);
  await coordinatedNearRead("rpc-b",params,run);
  expect(run).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(2001);
  await coordinatedNearRead("rpc-b",params,run,2000);
  expect(run).toHaveBeenCalledTimes(3);
 });
 it("does not cache failures or reuse access-key nonces",async()=>{
  const failed=vi.fn(async()=>{throw new Error("rate limited");});
  await expect(coordinatedNearRead("rpc-c",params,failed,2000)).rejects.toThrow();
  const success=vi.fn(async()=>({nonce:1}));
  await coordinatedNearRead("rpc-c",params,success,2000);
  const nonce={request_type:"view_access_key",account_id:"employee.testnet"};
  await coordinatedNearRead("rpc-c",nonce,success,2000);
  await coordinatedNearRead("rpc-c",nonce,success,2000);
  expect(success).toHaveBeenCalledTimes(3);
 });
 it("invalidates advisory snapshots after a submission",async()=>{
  const run=vi.fn(async()=>({available:"10"}));
  await coordinatedNearRead("rpc-d",params,run,2000);
  invalidateNearReadCache();
  await coordinatedNearRead("rpc-d",params,run,2000);
  expect(run).toHaveBeenCalledTimes(2);
 });
 it("honors Retry-After rather than immediately hammering the provider",async()=>{
  vi.useFakeTimers();
  let finished=false;
  const waiting=backoffNearRead("limited-rpc",new Response(null,{status:429,headers:{"Retry-After":"2"}})).then(value=>{finished=value;});
  await vi.advanceTimersByTimeAsync(1999);expect(finished).toBe(false);
  await vi.advanceTimersByTimeAsync(1);await waiting;expect(finished).toBe(true);
 });
 it("does not retry during a long provider cooldown",async()=>{
  vi.useFakeTimers();
  expect(await backoffNearRead("daily-limited-rpc",new Response(null,{status:429,headers:{"Retry-After":"60"}}))).toBe(false);
  expect(await waitForRpcCooldown("daily-limited-rpc")).toBe(false);
  await vi.advanceTimersByTimeAsync(60001);
  expect(await waitForRpcCooldown("daily-limited-rpc")).toBe(true);
 });
});
it("does not repopulate a stale snapshot after cache invalidation",async()=>{
 invalidateNearReadCache();
 let finish!:(value:unknown)=>void;
 const old=coordinatedNearRead("mutation-rpc",params,()=>new Promise(resolve=>{finish=resolve;}),2000);
 invalidateNearReadCache();
 await coordinatedNearRead("mutation-rpc",params,async()=>({available:"0"}),2000);
 finish({available:"10"});await old;
 expect(await coordinatedNearRead("mutation-rpc",params,async()=>({available:"unexpected"}),2000)).toEqual({available:"0"});
});
