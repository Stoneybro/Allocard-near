import { describe, it, expect, vi, afterEach } from "vitest";
import { confirmNearOutcome, fundTreasury, getUnifiedNearCaller } from "@/lib/near";
import type { WalletSelector } from "@near-wallet-selector/core";
vi.mock("@near-wallet-selector/core", () => ({ actionCreators: { functionCall: (method: string, args: unknown, gas: bigint, deposit: bigint) => ({ method, args, gas, deposit }) } }));
const outcome = { transaction: { hash: "A".repeat(44), signer_id: "owner.testnet" }, status: { SuccessValue: "" } };
afterEach(() => vi.unstubAllGlobals());
describe("real wallet transactions", () => {
  it("does not fabricate FastAuth mutation success", async () => {
    await expect(getUnifiedNearCaller({ status: "authenticated", accountId: "owner.testnet", authMethod: "fast-auth" })).rejects.toThrow("not configured");
  });
  it("rejects a wallet result without a real transaction reference", async () => {
    await expect(confirmNearOutcome({ status: { SuccessValue: "" } })).rejects.toThrow();
  });
  it("resolves wallet outcomes with FINAL RPC semantics", async () => {
    const rpc = vi.fn(async (_url: unknown, _options: RequestInit) => Response.json({ result: outcome })); vi.stubGlobal("fetch", rpc);
    expect(await confirmNearOutcome(outcome)).toEqual(outcome);
    const sent = JSON.parse(String(rpc.mock.calls[0][1].body));
    expect(sent).toMatchObject({ method: "tx", params: { wait_until: "FINAL", sender_account_id: "owner.testnet" } });
  });
  it("funds all three pools in a single atomic action batch", async () => {
    const send = vi.fn(async (_request: unknown) => outcome); const selector = { wallet: async () => ({ signAndSendTransaction: send }) } as unknown as WalletSelector;
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: outcome })));
    await fundTreasury(selector, "owner.testnet", "treasury.testnet");
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0][0]).toMatchObject({ signerId: "owner.testnet", receiverId: "treasury.testnet", actions: [
      { method: "top_up_storage", deposit: BigInt("500000000000000000000000") },
      { method: "top_up_operating", deposit: BigInt("200000000000000000000000") },
      { method: "deposit_native", deposit: BigInt("1000000000000000000000000") },
    ] });
  });
  it("does not report a failed funding batch as successful", async () => {
    const selector = { wallet: async () => ({ signAndSendTransaction: async () => ({ ...outcome, status: { Failure: {} } }) }) } as unknown as WalletSelector;
    await expect(fundTreasury(selector, "owner.testnet", "treasury.testnet")).rejects.toThrow();
  });
});
