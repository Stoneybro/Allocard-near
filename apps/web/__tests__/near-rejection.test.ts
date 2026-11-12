import { describe, expect, it, vi } from "vitest";
import { describeNearRpcError, NearRpcError } from "@/lib/near-rpc-error";
vi.mock("@/lib/near-sponsor-client",()=>({sponsoredCreateCompany:vi.fn(),sponsoredExecute:vi.fn()}));
vi.mock("@/lib/near-rpc-client",()=>({nearBrowserRpc:vi.fn()}));
import { nearBrowserRpc } from "@/lib/near-rpc-client";
import { createPrivyNearTransport } from "@/lib/privy-near";
import { readPendingNearTransaction } from "@/lib/near-pending-transaction";
import { RetryableNearTransactionError } from "@/lib/near-transaction-error";
describe("authoritative NEAR validation rejection",()=>{
 it("marks cancellation before broadcast as safe to retry and leaves no pending transaction", async () => {
  const account = "ef".repeat(32);
  vi.mocked(nearBrowserRpc).mockReset().mockResolvedValueOnce({ permission: "FullAccess", nonce: "3", block_hash: "1".repeat(32) });
  const transport = createPrivyNearTransport(account, async () => { throw new Error("User cancelled signature"); });
  await expect(transport.caller.functionCall!({ contractId: "treasury.testnet", methodName: "create_child_permission", args: {} })).rejects.toBeInstanceOf(RetryableNearTransactionError);
  expect(readPendingNearTransaction(account)).toBeNull();
  expect(vi.mocked(nearBrowserRpc).mock.calls.map(([method]) => method)).toEqual(["query"]);
 });
 it("preserves the detailed InvalidTxError instead of only its generic name",()=>{
  const reason={InvalidNonce:{tx_nonce:3,ak_nonce:5}};
  const value=describeNearRpcError({message:"Server error",cause:{name:"INVALID_TRANSACTION"},data:{TxExecutionError:{InvalidTxError:reason}}});
  expect(value.invalidReason).toEqual(reason);expect(value.message).toContain('"InvalidNonce"');expect(value.message).toContain('"ak_nonce":5');
 });
 it("fails immediately on rejection and releases only that rejected submission",async()=>{
  const account="cd".repeat(32);
  vi.mocked(nearBrowserRpc).mockReset().mockResolvedValueOnce({permission:"FullAccess",nonce:"3",block_hash:"1".repeat(32)}).mockRejectedValueOnce(new NearRpcError("INVALID_TRANSACTION: InvalidNonce","INVALID_TRANSACTION"));
  const sign=vi.fn(async()=>`0x${"00".repeat(64)}` as `0x${string}`);
  await expect(createPrivyNearTransport(account,sign).caller.functionCall!({contractId:"treasury.testnet",methodName:"create_child_permission",args:{}})).rejects.toThrow("before execution");
  expect(vi.mocked(nearBrowserRpc).mock.calls.map(([method])=>method)).toEqual(["query","send_tx"]);
  expect(readPendingNearTransaction(account)).toBeNull();expect(sign).toHaveBeenCalledTimes(1);
 });
});
