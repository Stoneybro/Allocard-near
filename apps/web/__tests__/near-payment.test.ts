import { describe, it, expect, vi, afterEach } from "vitest";
import { assertSettledPayment, assertEmployeePermission, verifyPaymentTransaction } from "@/lib/near-server";
import type { Execution, Permission } from "@allocard/delegation-sdk";
const expected = { actor: "employee.testnet", permissionId: "7", receiver: "vendor.testnet", amount: "1000000000000000000000000" };
const record = { id: "1", actor: expected.actor, authority_mode: "Delegated", permission_id: "7", status: "Succeeded", request_id: "a".repeat(64), action: { type: "Transfer", asset: { type: "NativeNear" }, receiver: expected.receiver, amount: expected.amount } } as Execution;
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe("authoritative payment verification", () => {
  it("requires exact actor, permission, recipient, amount, asset and settlement", () => {
    expect(() => assertSettledPayment(record, expected)).not.toThrow();
    for (const changed of [null, { ...record, status: "Pending" }, { ...record, status: "Failed" }, { ...record, actor: "attacker.testnet" }, { ...record, permission_id: "8" }, { ...record, authority_mode: "OwnerWithdrawal" }, { ...record, action: { ...record.action, receiver: "other.testnet" } }, { ...record, action: { ...record.action, amount: "1" } }, { ...record, action: { ...record.action, asset: { type: "Nep141", contract_id: "token.testnet" } } }]) expect(() => assertSettledPayment(changed as Execution, expected)).toThrow();
  });
  it("rejects fabricated transaction references before RPC", async () => {
    const rpc = vi.fn(); vi.stubGlobal("fetch", rpc);
    await expect(verifyPaymentTransaction("near_tx_fake", expected.actor, "treasury.testnet", record.request_id)).rejects.toThrow();
    expect(rpc).not.toHaveBeenCalled();
  });
  it("binds a real transaction to signer, treasury and exact request", async () => {
    const hash = "A".repeat(44);
    const transaction = { hash, signer_id: expected.actor, receiver_id: "treasury.testnet", actions: [{ FunctionCall: { method_name: "execute", args: Buffer.from(JSON.stringify({ request: { request_id: record.request_id } })).toString("base64") } }] };
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: { status: { SuccessValue: "IjEi" }, transaction } })));
    await expect(verifyPaymentTransaction(hash, expected.actor, "treasury.testnet", record.request_id)).resolves.toBeUndefined();
    await expect(verifyPaymentTransaction(hash, "other.testnet", "treasury.testnet", record.request_id)).rejects.toThrow();
    await expect(verifyPaymentTransaction(hash, expected.actor, "treasury.testnet", "b".repeat(64))).rejects.toThrow();
  });
  it("looks up relayed transactions under the outer signer and verifies the inner employee", async () => {
    vi.stubEnv("NEAR_RELAYER_ACCOUNT_ID", "sponsor.testnet");
    const hash = "A".repeat(44);
    const transaction = { hash, signer_id: "sponsor.testnet", receiver_id: expected.actor, actions: [{ Delegate: { delegate_action: {
      sender_id: expected.actor, receiver_id: "treasury.testnet", actions: [{ FunctionCall: { method_name: "execute", args: Buffer.from(JSON.stringify({ request: { request_id: record.request_id } })).toString("base64") } }],
    } } }] };
    const rpc = vi.fn().mockRejectedValueOnce(new Error("wrong shard")).mockResolvedValueOnce(Response.json({ result: { status: { SuccessValue: "IjEi" }, transaction } }));
    vi.stubGlobal("fetch", rpc);
    await expect(verifyPaymentTransaction(hash, expected.actor, "treasury.testnet", record.request_id)).resolves.toBeUndefined();
    expect(JSON.parse(rpc.mock.calls[1][1].body).params.sender_account_id).toBe("sponsor.testnet");
  });
  it("requires a root permission from this company's owner in the current epoch", () => {
    const permission = { delegate: expected.actor, issuer: "owner.testnet", parent_id: null, revoked: false, epoch: "2" } as Permission;
    expect(() => assertEmployeePermission(permission, expected.actor, "owner.testnet", "2")).not.toThrow();
    expect(() => assertEmployeePermission({ ...permission, revoked: true }, expected.actor, "owner.testnet", "2")).toThrow();
    expect(() => assertEmployeePermission(permission, expected.actor, "owner.testnet", "3")).toThrow();
    expect(() => assertEmployeePermission(permission, "attacker.testnet", "owner.testnet", "2")).toThrow();
  });
});
