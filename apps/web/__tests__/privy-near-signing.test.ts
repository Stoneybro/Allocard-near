import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPrivyNearTransport } from "@/lib/privy-near";
import { nextAccessKeyNonce, parseAccessKeyRpcResponse } from "@/lib/near-nonce";
import { SignedTransaction } from "near-api-js/lib/transaction";
vi.mock("@/lib/near-sponsor-client", () => ({ sponsoredCreateCompany: vi.fn(async () => null), sponsoredExecute: vi.fn(async () => null) }));
vi.mock("@/lib/near-rpc-client",()=>({nearBrowserRpc:vi.fn()}));
import { nearBrowserRpc } from "@/lib/near-rpc-client";
const account="ab".repeat(32);
beforeEach(()=>vi.clearAllMocks());
describe("exact NEAR transaction nonces",()=>{
 it.each([0,"0",42,"42",BigInt(42)])("accepts a valid numeric or decimal nonce %s",value=>{
  expect(nextAccessKeyNonce(value)).toBe(BigInt(String(value))+BigInt(1));
 });
 it("preserves u64 nonces larger than JavaScript's safe range",()=>{
  expect(nextAccessKeyNonce("9007199254740993")).toBe(BigInt("9007199254740994"));
  const parsed=parseAccessKeyRpcResponse('{"result":{"nonce":9007199254740993,"permission":"FullAccess"}}');
  expect(parsed.result.nonce).toBe("9007199254740993");
 });
 it.each([-1,1.5,Number.MAX_SAFE_INTEGER+1,"-1","1.5","1e3","","18446744073709551615",null,undefined,{}])("rejects invalid or exhausted nonce %s",value=>{
  expect(()=>nextAccessKeyNonce(value)).toThrow();
 });
});
describe("Privy signing preflight",()=>{
 it("signs with an exact decimal-string nonce",async()=>{
  vi.mocked(nearBrowserRpc).mockResolvedValueOnce({permission:"FullAccess",nonce:"9007199254740993",block_hash:"1".repeat(32)}).mockResolvedValueOnce({status:{SuccessValue:'"1"'}});
  const signHash=vi.fn(async()=>`0x${"00".repeat(64)}` as `0x${string}`);
  const transport=createPrivyNearTransport(account,signHash);
  await transport.caller.functionCall!({contractId:"shared.testnet",methodName:"execute",args:{},gas:"150000000000000",attachedDeposit:"0"});
  expect(signHash).toHaveBeenCalledTimes(1);
  const [method,params]=vi.mocked(nearBrowserRpc).mock.calls[1];
  expect(method).toBe("send_tx");
  const signed=SignedTransaction.decode(Buffer.from((params as {signed_tx_base64:string}).signed_tx_base64,"base64"));
  expect(signed.transaction.nonce.toString()).toBe("9007199254740994");
 });
 it("does not sign or broadcast with a restricted key",async()=>{
  vi.mocked(nearBrowserRpc).mockResolvedValueOnce({permission:{FunctionCall:{receiver_id:"shared.testnet"}},nonce:"1",block_hash:"1".repeat(32)});
  const signHash=vi.fn();
  const transport=createPrivyNearTransport(account,signHash);
  await expect(transport.caller.functionCall!({contractId:"shared.testnet",methodName:"execute"})).rejects.toThrow("FunctionCall");
  expect(signHash).not.toHaveBeenCalled();expect(nearBrowserRpc).toHaveBeenCalledTimes(1);
 });
 it("distinguishes an invalid RPC shape from permission and nonce errors",async()=>{
  vi.mocked(nearBrowserRpc).mockResolvedValueOnce({amount:"100"});
  const signHash=vi.fn();
  await expect(createPrivyNearTransport(account,signHash).caller.functionCall!({contractId:"shared.testnet",methodName:"execute"})).rejects.toThrow("access-key record");
  expect(signHash).not.toHaveBeenCalled();
 });
});

describe("uncertain transaction recovery", () => {
 const request = { contractId:"shared.testnet",methodName:"create_child_permission",args:{parent_id:"1",spec:{delegate:"adapter.testnet",valid_from_ms:"100"}},gas:"40000000000000",attachedDeposit:"0" };
 const access = { permission:"FullAccess",nonce:"4",block_hash:"1".repeat(32) };
 const success = { status:{SuccessValue:"IjIi"} };
 it("checks the signed hash after a submission error without rebroadcasting", async () => {
  vi.mocked(nearBrowserRpc).mockResolvedValueOnce(access).mockRejectedValueOnce(new Error("Server error")).mockResolvedValueOnce(success);
  const sign=vi.fn(async()=>`0x${"00".repeat(64)}` as `0x${string}`);
  expect(await createPrivyNearTransport(account,sign).caller.functionCall!(request)).toEqual(success);
  expect(sign).toHaveBeenCalledTimes(1);
  expect(vi.mocked(nearBrowserRpc).mock.calls.map(([method])=>method)).toEqual(["query","send_tx","tx"]);
  expect(vi.mocked(nearBrowserRpc).mock.calls[2][1]).toMatchObject({sender_account_id:account,wait_until:"FINAL"});
 });
 it("recovers the original permission after transport recreation without signing again", async () => {
  vi.mocked(nearBrowserRpc).mockResolvedValueOnce(access).mockRejectedValueOnce(new Error("timeout")).mockRejectedValueOnce(new Error("timeout"));
  const sign=vi.fn(async()=>`0x${"00".repeat(64)}` as `0x${string}`);
  await expect(createPrivyNearTransport(account,sign).caller.functionCall!(request)).rejects.toThrow("no new transaction will be signed");
  vi.mocked(nearBrowserRpc).mockResolvedValueOnce(success);
  const secondSign=vi.fn();
  const retried={...request,args:{...request.args,spec:{...request.args.spec,valid_from_ms:"200"}}};
  expect(await createPrivyNearTransport(account,secondSign).caller.functionCall!(retried)).toEqual(success);
  expect(secondSign).not.toHaveBeenCalled();
  expect(vi.mocked(nearBrowserRpc).mock.calls.filter(([method])=>method==="send_tx")).toHaveLength(1);
 });
 it("does not sign a different action while resolving an earlier submission", async () => {
  vi.mocked(nearBrowserRpc).mockResolvedValueOnce(access).mockRejectedValueOnce(new Error("timeout")).mockRejectedValueOnce(new Error("timeout"));
  await expect(createPrivyNearTransport(account,async()=>`0x${"00".repeat(64)}`).caller.functionCall!(request)).rejects.toThrow("could not be confirmed");
  vi.mocked(nearBrowserRpc).mockResolvedValueOnce(success);
  const sign=vi.fn();
  await expect(createPrivyNearTransport(account,sign).caller.functionCall!({...request,methodName:"revoke_permission"})).rejects.toThrow("Previous transaction");
  expect(sign).not.toHaveBeenCalled();
 });
 it("reports the actual contract failure after recovering the execution outcome", async () => {
  vi.mocked(nearBrowserRpc).mockResolvedValueOnce(access).mockRejectedValueOnce(new Error("Server error")).mockResolvedValueOnce({status:{Failure:{ActionError:{kind:{FunctionCallError:{ExecutionError:"Child exceeds parent budget"}}}}}});
  await expect(createPrivyNearTransport(account,async()=>`0x${"00".repeat(64)}`).caller.functionCall!(request)).rejects.toThrow("Child exceeds parent budget");
 });
});

describe("payment and adapter transaction isolation",()=>{
 it("allows a sponsored payment despite a pending older adapter transaction",async()=>{
  const {savePendingNearTransaction,readPendingNearTransaction,clearPendingNearTransaction}=await import("@/lib/near-pending-transaction");
  const {sponsoredExecute}=await import("@/lib/near-sponsor-client");
  savePendingNearTransaction(account,{hash:"1".repeat(44),requestKey:JSON.stringify({methodName:"create_child_permission"})});
  try {
   vi.mocked(sponsoredExecute).mockResolvedValueOnce({status:{SuccessValue:"IjEi"}});
   const sign=vi.fn();
   expect(await createPrivyNearTransport(account,sign).caller.functionCall!({contractId:"shared.testnet",methodName:"execute",args:{request:{}},attachedDeposit:"0"})).toEqual({status:{SuccessValue:"IjEi"}});
   expect(nearBrowserRpc).not.toHaveBeenCalled();expect(sign).not.toHaveBeenCalled();expect(readPendingNearTransaction(account)?.hash).toBe("1".repeat(44));
  } finally {clearPendingNearTransaction(account);}
 });
 it("still blocks a second payment when the original payment is uncertain",async()=>{
  const {savePendingNearTransaction,clearPendingNearTransaction}=await import("@/lib/near-pending-transaction");
  const {sponsoredExecute}=await import("@/lib/near-sponsor-client");
  savePendingNearTransaction(account,{hash:"1".repeat(44),requestKey:JSON.stringify({methodName:"execute"})});
  try {
   vi.mocked(nearBrowserRpc).mockRejectedValueOnce(new Error("unknown"));
   await expect(createPrivyNearTransport(account,vi.fn()).caller.functionCall!({contractId:"shared.testnet",methodName:"execute",args:{request:{}}})).rejects.toThrow("still unconfirmed");
   expect(sponsoredExecute).not.toHaveBeenCalled();
  } finally {clearPendingNearTransaction(account);}
 });
 it("does not fall back to a wallet signature when sponsorship is disabled and another intent is pending",async()=>{
  const {savePendingNearTransaction,clearPendingNearTransaction}=await import("@/lib/near-pending-transaction");
  const {sponsoredExecute}=await import("@/lib/near-sponsor-client");
  savePendingNearTransaction(account,{hash:"1".repeat(44),requestKey:JSON.stringify({methodName:"create_child_permission"})});
  try {
   vi.mocked(sponsoredExecute).mockResolvedValueOnce(null);const sign=vi.fn();
   await expect(createPrivyNearTransport(account,sign).caller.functionCall!({contractId:"shared.testnet",methodName:"execute",args:{request:{}}})).rejects.toThrow("Gas sponsorship is disabled");
   expect(sign).not.toHaveBeenCalled();expect(nearBrowserRpc).not.toHaveBeenCalled();
  } finally {clearPendingNearTransaction(account);}
 });
});
