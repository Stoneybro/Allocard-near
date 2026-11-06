import { afterEach, describe, expect, it, vi } from "vitest";
import { assertTreasuryCode } from "@/lib/near-server";
import { provisionTreasury, type FactoryConfig } from "@/lib/treasury-factory";
import type { NearCaller } from "@allocard/delegation-sdk";
const config = { factoryId: "factory.testnet", creation_deposit: "120000000000000000000000" } as FactoryConfig;
const target = "c-123.factory.testnet";
const record = { owner: "owner.testnet", treasury_id: target, status: "Ready" };
afterEach(() => vi.unstubAllGlobals());
function rpc(records: unknown[]) {
  vi.stubGlobal("fetch", vi.fn(async (_url, options) => {
    const body = JSON.parse(String(options?.body));
    const value = body.params.method_name === "get_treasury_id" ? target : records.shift();
    return Response.json({ result: { result: [...new TextEncoder().encode(JSON.stringify(value))] } });
  }));
}
describe("factory onboarding reconciliation", () => {
  it("reuses an existing ready treasury without signing or paying again", async () => {
    rpc([record]); const call=vi.fn();
    expect(await provisionTreasury({ accountId: "owner.testnet", functionCall: call } as unknown as NearCaller, config, "company-1")).toBe(target);
    expect(call).not.toHaveBeenCalled();
  });
  it("does not resubmit a pending creation", async () => {
    rpc([{ ...record, status: "Pending" }]); const call=vi.fn();
    await expect(provisionTreasury({ accountId: "owner.testnet", functionCall: call } as unknown as NearCaller, config, "company-1")).rejects.toThrow("pending");
    expect(call).not.toHaveBeenCalled();
  });
  it("uses an ordinary function call and verifies the resulting creation", async () => {
    rpc([null, record]); const call=vi.fn(async () => ({}));
    expect(await provisionTreasury({ accountId: "owner.testnet", functionCall: call } as unknown as NearCaller, config, "company-1")).toBe(target);
    expect(call).toHaveBeenCalledWith(expect.objectContaining({ methodName: "create_company", args: { company_key: "company-1" }, attachedDeposit: config.creation_deposit }));
  });
  it("recovers a creation that finalized after the submission timed out", async () => {
    rpc([null, record]);
    expect(await provisionTreasury({ accountId: "owner.testnet", functionCall: async () => { throw new Error("timeout"); } } as unknown as NearCaller, config, "company-1")).toBe(target);
  });
  it("does not report callback-level setup failure as successful", async () => {
    rpc([null, { ...record, status: "RefundAvailable" }]);
    await expect(provisionTreasury({ accountId: "owner.testnet", functionCall: async () => ({}) } as unknown as NearCaller, config, "company-1")).rejects.toThrow("Claim the setup refund");
  });
  it("rejects a record for a different owner", async () => {
    rpc([{ ...record, owner: "attacker.testnet" }]); const call=vi.fn();
    await expect(provisionTreasury({ accountId: "owner.testnet", functionCall: call } as unknown as NearCaller, config, "company-1")).rejects.toThrow("does not match");
    expect(call).not.toHaveBeenCalled();
  });
});
describe("treasury code identity", () => {
  it("accepts an exact local deployment or hash-pinned global reference", () => {
    expect(() => assertTreasuryCode({ code_hash: "expected" }, "expected")).not.toThrow();
    expect(() => assertTreasuryCode({ code_hash: "empty", global_contract_hash: "expected" }, "expected")).not.toThrow();
  });
  it("rejects mutable global references and different bytecode", () => {
    expect(() => assertTreasuryCode({ code_hash: "expected", global_contract_account_id: "publisher.testnet" }, "expected")).toThrow("Mutable");
    expect(() => assertTreasuryCode({ code_hash: "expected", global_contract_hash: "different" }, "expected")).toThrow("does not match");
  });
});
