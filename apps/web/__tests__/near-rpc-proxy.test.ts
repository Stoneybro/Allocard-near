import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyPair } from "near-api-js";
import { createTransaction, SignedTransaction, Signature, functionCall } from "near-api-js/lib/transaction";
vi.mock("@/lib/session", () => ({ getSessionIdentity: vi.fn() }));
import { getSessionIdentity } from "@/lib/session";
import { POST } from "@/app/api/near/rpc/route";
import { nearBrowserRpc } from "@/lib/near-rpc-client";
const origin="http://localhost:3000";
function request(method:string,params:unknown,requestOrigin=origin) {
 return new Request(`${origin}/api/near/rpc`,{method:"POST",headers:{Origin:requestOrigin,"Content-Type":"application/json"},body:JSON.stringify({jsonrpc:"2.0",id:"test",method,params})});
}
function signed(signerId:string) {
 const publicKey=KeyPair.fromRandom("ed25519").getPublicKey();
 const transaction=createTransaction(signerId,publicKey,"shared.testnet",BigInt(1),[functionCall("execute",{},BigInt("150000000000000"),BigInt(0))],new Uint8Array(32));
 return Buffer.from(new SignedTransaction({transaction,signature:new Signature({keyType:publicKey.keyType,data:new Uint8Array(64)})}).encode()).toString("base64");
}
beforeEach(()=>vi.resetAllMocks());
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("same-origin NEAR RPC gateway",()=>{
 it.each([
  ["access key ed25519:example does not exist while viewing", "signing key is not registered"],
  ["account employee.testnet does not exist while viewing", "account does not exist"],
 ])("rejects legacy result.error responses: %s",async(message,expected)=>{
  vi.stubGlobal("fetch",vi.fn(async()=>Response.json({result:{error:message,block_hash:"1".repeat(32)}})));
  const response=await POST(request("query",{request_type:"view_access_key",account_id:"employee.testnet",public_key:"ed25519:test"}));
  expect(response.status).toBe(502);
  expect((await response.json()).error.message).toContain(expected);
 });
 it("preserves a large access-key nonce exactly across the gateway",async()=>{
  vi.stubGlobal("fetch",vi.fn(async()=>new Response('{"result":{"nonce":9007199254740993,"permission":"FullAccess","block_hash":"11111111111111111111111111111111"}}',{headers:{"Content-Type":"application/json"}})));
  const response=await POST(request("query",{request_type:"view_access_key",account_id:"employee.testnet",public_key:"ed25519:test"}));
  expect(response.status).toBe(200);
  expect((await response.json()).result.nonce).toBe("9007199254740993");
 });
 it("forwards read queries to the server-configured RPC without changing company arguments",async()=>{
  vi.stubEnv("NEAR_RPC_URL","https://private-rpc.example/test");
  const fetcher=vi.fn(async(_url:unknown,_options:RequestInit)=>Response.json({result:{result:[49]}}));vi.stubGlobal("fetch",fetcher);
  const params={request_type:"call_function",account_id:"shared.testnet",method_name:"get_config",args_base64:Buffer.from(JSON.stringify({company_id:"a".repeat(64)})).toString("base64"),finality:"final"};
  expect((await POST(request("query",params))).status).toBe(200);
  expect(fetcher.mock.calls[0][0]).toBe("https://private-rpc.example/test");
  expect(JSON.parse(String(fetcher.mock.calls[0][1].body))).toEqual({jsonrpc:"2.0",id:"test",method:"query",params});
 });
 it("rejects cross-origin calls and unsupported methods before contacting RPC",async()=>{
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  expect((await POST(request("query",{},"https://attacker.example"))).status).toBe(403);
  expect((await POST(request("broadcast_tx_commit",{}))).status).toBe(400);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it("retries failed reads and returns a useful connection error",async()=>{
  const fetcher=vi.fn(async()=>{throw new Error("fetch failed");});vi.stubGlobal("fetch",fetcher);
  const response=await POST(request("query",{request_type:"view_account",account_id:"owner.testnet"}));
  expect(response.status).toBe(502);expect(fetcher).toHaveBeenCalledTimes(2);
  expect((await response.json()).error.message).toContain("server could not reach NEAR");
 });
 it("requires a verified session for broadcasting",async()=>{
  vi.mocked(getSessionIdentity).mockResolvedValue(null);
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  expect((await POST(request("send_tx",{signed_tx_base64:signed("owner.testnet")}))).status).toBe(401);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it("rejects a transaction signed by a different account",async()=>{
  vi.mocked(getSessionIdentity).mockResolvedValue({walletAddress:"owner.testnet",providerUserId:"user",email:"owner@example.com"});
  const fetcher=vi.fn();vi.stubGlobal("fetch",fetcher);
  expect((await POST(request("send_tx",{signed_tx_base64:signed("other.testnet")}))).status).toBe(403);
  expect(fetcher).not.toHaveBeenCalled();
 });
 it("does not automatically retry a transaction after a network failure",async()=>{
  vi.mocked(getSessionIdentity).mockResolvedValue({walletAddress:"owner.testnet",providerUserId:"user",email:"owner@example.com"});
  const fetcher=vi.fn(async()=>{throw new Error("network reset");});vi.stubGlobal("fetch",fetcher);
  const response=await POST(request("send_tx",{signed_tx_base64:signed("owner.testnet"),wait_until:"FINAL"}));
  expect(response.status).toBe(502);expect(fetcher).toHaveBeenCalledTimes(1);
  expect((await response.json()).error.message).toContain("uncertain");
 });
});
it("browser RPC calls use the application origin",async()=>{
 const fetcher=vi.fn(async()=>Response.json({result:{amount:"1"}}));vi.stubGlobal("fetch",fetcher);
 expect(await nearBrowserRpc("query",{request_type:"view_account",account_id:"owner.testnet"})).toEqual({amount:"1"});
 expect(fetcher).toHaveBeenCalledWith("/api/near/rpc",expect.objectContaining({credentials:"same-origin"}));
});
