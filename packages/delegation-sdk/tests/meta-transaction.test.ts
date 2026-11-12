import { describe, expect, it, vi } from "vitest";
import { AllocardTreasuryClient, decodeMutationId } from "../src/client.js";
import type { ExecuteRequest, Execution } from "../src/types.js";
const actor = "employee.testnet";
const companyId = "c".repeat(64);
const request: ExecuteRequest = { api_version: 1, request_id: "a".repeat(64), permission_id: "7", deadline_ms: "1794020000000",
  action: { type: "Transfer", asset: { type: "NativeNear" }, receiver: "vendor.testnet", amount: "1000000000000000000000" } };
function setup() {
  const send = vi.fn(async () => ({ status: { SuccessValue: "" }, transaction: { hash: "original-meta-transaction" } }));
  let record: Execution;
  const read = vi.fn(async () => record);
  const client = new AllocardTreasuryClient({ contractId: `shared.testnet#${companyId}`, networkDomain: "near:testnet", caller: { accountId: actor, viewFunction: read, functionCall: send } });
  record = { id: "9007199254740993", actor, request_id: request.request_id, request_hash: client.getExecuteHash(actor, request), authority_mode: "Delegated", permission_id: "7", epoch: "1", action: request.action, created_at_ms: "1794019000000", status: "Succeeded", needs_reconciliation: false, reservations: [] };
  return { client, send, read, record };
}
describe("NEP-366 empty outer return values", () => {
  it("reconciles the exact company-scoped replay record and preserves the outer transaction hash", async () => {
    const { client, send, read, record } = setup();
    const result = await client.execute(request);
    expect(result.executionId).toBe(record.id);
    expect(result.transactionHash).toBe("original-meta-transaction");
    expect(read).toHaveBeenCalledWith({ contractId: "shared.testnet", methodName: "get_execution_by_request", args: { actor, request_id: request.request_id, company_id: companyId } });
    expect(await result.waitForOutcome()).toEqual(record);
    expect(read).toHaveBeenCalledTimes(1); // Reuse the already verified terminal replay record.
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("allows a pending execution to continue through normal settlement polling", async () => {
    const { client, read, record } = setup();
    read.mockResolvedValueOnce({ ...record, status: "Pending" }).mockResolvedValue(record);
    const result = await client.execute(request);
    expect((await result.waitForOutcome()).status).toBe("Succeeded");
  });
  it("returns a failed execution so the application can release its pending request normally", async () => {
    const { client, record } = setup(); record.status = "Failed";
    expect((await (await client.execute(request)).waitForOutcome()).status).toBe("Failed");
  });
  it.each([
    ["actor", "attacker.testnet"], ["request_id", "b".repeat(64)], ["request_hash", "b".repeat(64)],
    ["authority_mode", "OwnerWithdrawal"], ["permission_id", "8"],
  ])("rejects a mismatched replay record field %s without submitting a replacement", async (field, value) => {
    const { client, send, record } = setup(); Object.assign(record, { [field]: value });
    await expect(client.execute(request)).rejects.toThrow("matching treasury execution could not be verified");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("rejects a missing replay record without attempting JSON.parse on the empty result", async () => {
    const { client, send, read } = setup(); read.mockResolvedValue(null as unknown as Execution);
    await expect(client.execute(request)).rejects.toThrow("Keep this payment request");
    expect(send).toHaveBeenCalledTimes(1);
  });
  it("requires the company-specific request hash", async () => {
    const { client, record } = setup();
    const differentCompany = new AllocardTreasuryClient({ contractId: `shared.testnet#${"d".repeat(64)}`, networkDomain: "near:testnet", caller: { viewFunction: async () => null } });
    record.request_hash = differentCompany.getExecuteHash(actor, request);
    await expect(client.execute(request)).rejects.toThrow("matching treasury execution");
  });
  it("does not turn a failed transaction into a successful replay lookup", async () => {
    const { client, send, read } = setup();
    send.mockResolvedValueOnce({ status: { Failure: { error: "denied" } } } as unknown as Awaited<ReturnType<typeof send>>);
    await expect(client.execute(request)).rejects.toThrow("NEAR transaction failed");
    expect(read).not.toHaveBeenCalled();
  });
  it("gives an actionable generic decoder error for empty and malformed return values", () => {
    expect(() => decodeMutationId({ status: { SuccessValue: "" } })).toThrow("without a contract return value");
    expect(() => decodeMutationId({ status: { SuccessValue: btoa("not json") } })).toThrow("invalid encoded JSON");
  });
});
