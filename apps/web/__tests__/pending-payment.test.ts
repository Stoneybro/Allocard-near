import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Execution } from "@allocard/delegation-sdk";
import { preparePendingPayment, type PendingPayment } from "@/lib/pending-payment";
const key = "allocard-payment:shared.testnet#company:employee.testnet";
const old: PendingPayment = { attempted: true, delegationId: "old-delegation", transactionHash: "old-hash", executionId: "old-id", request: {
  api_version: 1, request_id: "a".repeat(64), permission_id: "7", deadline_ms: "100",
  action: { type: "Transfer", asset: { type: "NativeNear" }, receiver: "vendor.testnet", amount: "10" },
} };
let entries: Map<string, string>;
function input() {
  return { key, companyId: "company", receiver: "vendor.testnet", amount: "10", activePermissionId: "9", delegationId: "current-delegation",
    storage: { getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } },
    readExecution: vi.fn().mockResolvedValue(null),
  };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(1000000); entries = new Map([[key, JSON.stringify(old)]]); });
afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals(); });
describe("pending employee payment recovery", () => {
  it("replaces a confirmed expired unused request in the same send attempt, using the current permission", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ execution: null, canDiscard: true })));
    const { saved, existing } = await preparePendingPayment(input());
    expect(existing).toBeNull(); expect(saved.request.request_id).not.toBe(old.request.request_id);
    expect(saved.request.request_id).toMatch(/^[0-9a-f]{64}$/);
    expect(saved.request.permission_id).toBe("9"); expect(saved.delegationId).toBe("current-delegation");
    expect(saved.request.deadline_ms).toBe(String(Date.now() + 900000));
    expect(saved.transactionHash).toBeUndefined(); expect(saved.executionId).toBeUndefined(); expect(saved.attempted).toBe(false);
    expect(JSON.parse(entries.get(key)!)).toEqual(saved);
  });
  it("preserves an unresolved request when finalized chain time has not passed its deadline", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ execution: null, canDiscard: false })));
    await expect(preparePendingPayment(input())).rejects.toThrow("still unresolved");
    expect(JSON.parse(entries.get(key)!)).toEqual(old);
  });
  it("preserves the old request if reconciliation fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Connection unavailable" }, { status: 503 })));
    await expect(preparePendingPayment(input())).rejects.toThrow("Connection unavailable");
    expect(JSON.parse(entries.get(key)!)).toEqual(old);
  });
  it("keeps an execution that appears between the first read and final reconciliation", async () => {
    const record = { id: "42", request_id: old.request.request_id, status: "Pending" } as Execution;
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ execution: record, canDiscard: false })));
    const result = await preparePendingPayment(input());
    expect(result.existing).toEqual(record); expect(result.saved).toEqual(old);
    expect(JSON.parse(entries.get(key)!)).toEqual(old);
  });
  it("never replaces a known execution, even after expiry or permission changes", async () => {
    const options = input(); options.readExecution.mockResolvedValue({ id: "42", status: "Succeeded" });
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    const result = await preparePendingPayment(options);
    expect(result.saved).toEqual(old); expect(fetcher).not.toHaveBeenCalled();
  });
  it("keeps the same request ID for a live retry", async () => {
    const live = { ...old, request: { ...old.request, deadline_ms: "2000000" } };
    entries.set(key, JSON.stringify(live)); vi.stubGlobal("fetch", vi.fn());
    expect((await preparePendingPayment(input())).saved).toEqual(live);
    expect(fetch).not.toHaveBeenCalled();
  });
  it("allows a changed recipient only after the old request is proven unused and expired", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ execution: null, canDiscard: true })));
    const result = await preparePendingPayment({ ...input(), receiver: "new-vendor.testnet", amount: "20" });
    expect(result.saved.request.action.receiver).toBe("new-vendor.testnet"); expect(result.saved.request.action.amount).toBe("20");
  });
  it("does not overwrite a live payment with different details", async () => {
    const live = { ...old, request: { ...old.request, deadline_ms: "2000000" } }; entries.set(key, JSON.stringify(live));
    await expect(preparePendingPayment({ ...input(), amount: "20" })).rejects.toThrow("original recipient and amount");
    expect(JSON.parse(entries.get(key)!)).toEqual(live);
  });
  it("requires a current permission for a fresh request after discarding an expired one", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ execution: null, canDiscard: true })));
    await expect(preparePendingPayment({ ...input(), activePermissionId: null })).rejects.toThrow("confirmed company permission");
    expect(entries.has(key)).toBe(false);
  });
});
