import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], inserted: [] as unknown[], values: vi.fn(), readExecution: vi.fn() }));
vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: async () => ({ id: "employee", embeddedWalletAddress: "employee.testnet" }), requireEmployeeCompany: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: {
  select: () => ({ from: () => ({ where: () => ({ limit: async () => mocks.rows.shift() ?? [] }) }) }),
  insert: () => ({ values: (value: unknown) => { mocks.values(value); return { onConflictDoNothing: () => ({ returning: async () => mocks.inserted }) }; } }),
} }));
vi.mock("@/lib/near-server", async importOriginal => {
  const actual = await importOriginal<typeof import("@/lib/near-server")>();
  return { ...actual, treasuryReader: () => ({ getExecution: mocks.readExecution }), verifyPaymentTransaction: vi.fn(async () => undefined) };
});
import { POST } from "@/app/api/wallet/spend/route";
const details = { companyId: "company", employeeId: "employee", delegationId: "delegation", toAddress: "vendor.testnet", amountNear: "0.1", txHash: "A".repeat(44), executionId: "9" };
const record = { status: "Succeeded", actor: "employee.testnet", permission_id: "7", authority_mode: "Delegated", request_id: "a".repeat(64), action: { asset: { type: "NativeNear" }, receiver: "vendor.testnet", amount: "100000000000000000000000" } };
function request(body: unknown) { return new NextRequest("http://localhost/api/wallet/spend", { method: "POST", body: JSON.stringify(body) }); }
beforeEach(() => { vi.clearAllMocks(); mocks.rows = [[{ delegationHash: "7" }], [{ smartAccountAddress: "treasury.testnet" }]]; mocks.inserted = [{ id: "record" }]; mocks.readExecution.mockResolvedValue(record); });
describe("payment history accepts only settled executions", () => {
  it("does not record a pending or failed transfer", async () => {
    mocks.readExecution.mockResolvedValue({ ...record, status: "Pending" });
    expect((await POST(request(details))).status).toBe(409); expect(mocks.values).not.toHaveBeenCalled();
  });
  it("does not record someone else's payment or altered amount", async () => {
    expect((await POST(request({ ...details, amountNear: "1" }))).status).toBe(409); expect(mocks.values).not.toHaveBeenCalled();
  });
  it("records a verified execution with a unique treasury/execution identity", async () => {
    expect((await POST(request(details))).status).toBe(200);
    expect(mocks.values).toHaveBeenCalledWith(expect.objectContaining({ treasuryContractId: "treasury.testnet", executionId: "9", amountNear: "0.1" }));
  });
  it("returns an existing record after a retry without inserting a duplicate", async () => {
    mocks.inserted = []; mocks.rows.push([{ id: "existing", employeeId: "employee", companyId: "company", delegationId: "delegation" }]);
    const response = await POST(request(details)); expect(response.status).toBe(200); expect((await response.json()).transaction.id).toBe("existing");
  });
  it("rejects a supplied request identity that differs from the settled execution", async () => {
    expect((await POST(request({ ...details, requestId: "b".repeat(64) }))).status).toBe(409);
    expect(mocks.values).not.toHaveBeenCalled();
  });
});
