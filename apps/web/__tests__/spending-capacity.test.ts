import { describe, it, expect, vi } from "vitest";
import { nativeSpendingCapacity } from "@/lib/spending-capacity";
import type { Permission, TreasuryConfig, BudgetScope } from "@allocard/delegation-sdk";
const permission: Permission = { id: "1", issuer: "owner.testnet", delegate: "employee.testnet", parent_id: null, depth: 0, epoch: "2", valid_from_ms: "0", expires_at_ms: null, revoked: false, redelegation_depth: 0, rules: [{ asset: { type: "NativeNear" }, recipients: { type: "Any" }, lifetime_limit: "1000", fixed_window: { limit: "500", anchor_ms: "0", duration_ms: "100" }, acknowledge_unbounded_budget: false }] };
function input() { return { actor: "employee.testnet", path: [permission], config: { paused: false, authority_epoch: "2" } as TreasuryConfig, available: "10000", now: BigInt(250), blocked: async (_id: string) => false, usage: vi.fn(async (_id: string, scope: BudgetScope) => scope.type === "Lifetime" ? { settled: "100", pending: "100" } : { settled: "300", pending: "50" }) }; }
describe("live native spending capacity", () => {
  it("deducts pending and settled usage from every applicable cap", async () => {
    const context = input(); expect(await nativeSpendingCapacity(context)).toBe("150");
    expect(context.usage).toHaveBeenCalledWith("1", { type: "FixedWindow", window_index: "2" });
  });
  it("reports zero capacity when the execution count is exhausted", async () => {
    expect(await nativeSpendingCapacity({ ...input(), path: [{ ...permission, max_executions: 2 }], executionCount: async () => 2 })).toBe("0");
  });
  it("bounds authority by actual treasury liquidity", async () => expect(await nativeSpendingCapacity({ ...input(), available: "20" })).toBe("20"));
  it.each([{ ...permission, revoked: true }, { ...permission, epoch: "1" }, { ...permission, delegate: "other.testnet" }, { ...permission, expires_at_ms: "250" }, { ...permission, valid_from_ms: "251" }])("rejects an inactive or wrong permission", async value => expect(await nativeSpendingCapacity({ ...input(), path: [value] })).toBe("0"));
  it("blocks paused treasuries and blocked ancestors", async () => {
    expect(await nativeSpendingCapacity({ ...input(), config: { paused: true } as TreasuryConfig })).toBe("0");
    expect(await nativeSpendingCapacity({ ...input(), blocked: async id => id === permission.issuer })).toBe("0");
  });
  it("shares ancestor capacity without reserving unused child allowances", async () => {
    const context = input(); context.path.push({ ...permission, id: "2", delegate: "manager.testnet", rules: [{ ...permission.rules[0], lifetime_limit: "120", fixed_window: null }] });
    context.usage = vi.fn(async (id: string) => ({ settled: id === "2" ? "100" : "0", pending: "10" }));
    expect(await nativeSpendingCapacity(context)).toBe("10");
  });
});

it("keeps unspent agent allocations out of direct spending after an agent spends", async () => {
 const base = input();
 const path = [{ ...permission, rules: [{ ...permission.rules[0], fixed_window: null }] }];
 expect(await nativeSpendingCapacity({ ...base, path, available: "1000", usage: async () => ({ settled: "0", pending: "0" }), reserved: async () => "300" })).toBe("700");
 expect(await nativeSpendingCapacity({ ...base, path, available: "900", usage: async () => ({ settled: "100", pending: "0" }), reserved: async () => "200" })).toBe("700");
});
it("excludes only the paying child's allocation while protecting sibling allocations", async () => {
 const root = { ...permission, rules: [{ ...permission.rules[0], fixed_window: null }] };
 const child = { ...root, id: "2", parent_id: "1", delegate: "agent.testnet", rules: [{ ...root.rules[0], lifetime_limit: "300" }] };
 const reserved = vi.fn(async (_id: string, exclude: string | null) => exclude === "2" ? "700" : "0");
 expect(await nativeSpendingCapacity({ ...input(), actor: child.delegate, path: [child, root], available: "1000", usage: async () => ({ settled: "0", pending: "0" }), reserved })).toBe("300");
 expect(reserved).toHaveBeenCalledWith("1", "2");
});
