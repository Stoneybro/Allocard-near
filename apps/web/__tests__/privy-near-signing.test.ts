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
