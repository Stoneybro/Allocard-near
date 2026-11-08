import { afterEach, describe, expect, it, vi } from "vitest";
import { AllocardTreasuryClient, type ExecuteRequest, type Execution } from "@allocard/delegation-sdk";
import { createPrivyNearTransport } from "@/lib/privy-near";
import { containsPaymentRequest, paymentActions } from "@/lib/near-payment-envelope";
vi.mock("@/lib/near-rpc-client", () => ({ nearBrowserRpc: vi.fn() }));
import { nearBrowserRpc } from "@/lib/near-rpc-client";
afterEach(() => { vi.unstubAllGlobals(); vi.resetAllMocks(); });
describe("sponsored payment recovery through the browser transport and SDK", () => {
  it("recovers an empty outer return through the exact execution record without another signature or submission", async () => {
    const actor = "a".repeat(64), companyId = "c".repeat(64), hash = "A".repeat(44);
    const request: ExecuteRequest = { api_version: 1, request_id: "b".repeat(64), permission_id: "7", deadline_ms: "1794020000000", action: { type: "Transfer", asset: { type: "NativeNear" }, receiver: "vendor.testnet", amount: "1000000000000000000000" } };
    const transaction = { hash, signer_id: "sponsor.testnet", receiver_id: actor, actions: [{ Delegate: { delegate_action: {
      sender_id: actor, receiver_id: "shared.testnet", actions: [{ FunctionCall: { method_name: "execute", args: Buffer.from(JSON.stringify({ request, company_id: companyId })).toString("base64") } }],
    } } }] };
    const fetcher = vi.fn().mockResolvedValue(Response.json({ enabled: true, outcome: { status: { SuccessValue: "" }, transaction } }));
    vi.stubGlobal("fetch", fetcher);
    const sign = vi.fn();
    const transport = createPrivyNearTransport(actor, sign);
    const client = new AllocardTreasuryClient({ contractId: `shared.testnet#${companyId}`, networkDomain: "near:testnet", caller: transport.caller });
    const record: Execution = { id: "1", actor, request_id: request.request_id, request_hash: client.getExecuteHash(actor, request), authority_mode: "Delegated", permission_id: "7", epoch: "1", action: request.action, created_at_ms: "1794019000000", status: "Succeeded", needs_reconciliation: false, reservations: [] };
    vi.mocked(nearBrowserRpc).mockResolvedValue({ result: [...Buffer.from(JSON.stringify(record))] });
    const result = await client.execute(request);
    expect(result.executionId).toBe("1"); expect(result.transactionHash).toBe(hash);
    expect((await result.waitForOutcome()).status).toBe("Succeeded");
    expect(sign).not.toHaveBeenCalled(); expect(fetcher).toHaveBeenCalledTimes(1);
    expect(JSON.parse(fetcher.mock.calls[0][1].body).operation).toBe("prepare");
    const read = vi.mocked(nearBrowserRpc).mock.calls[0][1] as { account_id: string; method_name: string; args_base64: string };
    expect(read.account_id).toBe("shared.testnet"); expect(read.method_name).toBe("get_execution_by_request");
    expect(JSON.parse(Buffer.from(read.args_base64, "base64").toString())).toEqual({ actor, request_id: request.request_id, company_id: companyId });
    expect(containsPaymentRequest(paymentActions(transaction, actor, "shared.testnet"), request.request_id, companyId)).toBe(true);
  });
});
