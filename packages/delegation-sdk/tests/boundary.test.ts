import { readFileSync } from "node:fs";
import { describe, it, expect, vi } from "vitest";
import { decodeMutationId, AllocardTreasuryClient } from "../src/client.js";
import { BorshWriter } from "../src/canonical.js";
import { parseTokenAmount, formatTokenAmount } from "../src/amounts.js";
import { createNearApiCaller } from "../src/near-api.js";
import type { Execution } from "../src/types.js";
import type { Account } from "near-api-js";

const fixture: Execution = JSON.parse(readFileSync(new URL("../../../docs/delegation/fixtures/execution.json", import.meta.url), "utf8"));

describe("contract boundaries", () => {
  it("decodes final outcome IDs without coercing objects or rounding", () => {
    const id = "18446744073709551615";
    expect(decodeMutationId({ status: { SuccessValue: btoa(JSON.stringify(id)) } })).toBe(id);
    expect(() => decodeMutationId({ status: { Failure: { error: "denied" } } })).toThrow("failed");
    for (const result of [{}, 42, "18446744073709551616", { status: "Started" }]) {
      expect(() => decodeMutationId(result)).toThrow();
    }
  });

  it("uses the Rust-tested execution JSON without losing precision", async () => {
    const client = new AllocardTreasuryClient({ contractId: "treasury.near", networkDomain: "near:mainnet",
      caller: { viewFunction: async () => fixture } });
    const record = await client.getExecution(fixture.id);
    expect(record?.request_hash).toMatch(/^[0-9a-f]{64}$/);
    expect(BigInt(record!.reservations[0].budget_key.permission_id)).toBe(9007199254740993n);
    expect(record?.failure_code).toBeNull();
  });

  it("adapts near-api-js v7 into a final transaction with exact amounts", async () => {
    const send = vi.fn(async () => ({ status: { SuccessValue: btoa('"42"') } }));
    const read = vi.fn(async () => fixture);
    const account = { accountId: "employee.near", provider: { callFunction: read }, signAndSendTransaction: send };
    const caller = createNearApiCaller(account as unknown as Account);
    const response = await caller.functionCall!({ contractId: "treasury.near", methodName: "execute", args: {}, gas: "80000000000000", attachedDeposit: "0" });
    expect(decodeMutationId(response)).toBe("42");
    expect(send.mock.calls[0]?.[0]).toMatchObject({ receiverId: "treasury.near", waitUntil: "FINAL", throwOnFailure: true });
    await caller.viewFunction({ contractId: "treasury.near", methodName: "get_execution", args: { execution_id: "42" } });
    expect(read).toHaveBeenCalledWith({ contractId: "treasury.near", method: "get_execution", args: { execution_id: "42" } });
  });

  it("parses and formats exact token amounts", () => {
    expect(parseTokenAmount("0.000000000000000000000001")).toBe("1");
    expect(formatTokenAmount(parseTokenAmount("1.234567890123456789012345"))).toBe("1.234567890123456789012345");
    for (const amount of ["1e24", "-1", "NaN", "0.0000001"]) expect(() => parseTokenAmount(amount, 6)).toThrow();
    expect(() => new BorshWriter().writeUint64LE("18446744073709551616")).toThrow();
    expect(() => new BorshWriter().writeUint128LE("-1")).toThrow();
  });
});
