import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { KeyPair } from "near-api-js";
import { SignedTransaction } from "near-api-js/lib/transaction";
const mocks = vi.hoisted(() => ({ access: vi.fn(), execution: vi.fn(), preview: vi.fn(), acquire: vi.fn(), allocate: vi.fn(), release: vi.fn(), updates: [] as unknown[][], insert: vi.fn(), events: [] as string[] }));
vi.mock("server-only", () => ({}));
vi.mock("@/lib/db", () => ({ db: {
  select: () => ({ from: () => ({ innerJoin: () => ({ where: () => ({ limit: async () => [{ owner: "owner.testnet" }] }) }) }) }),
  update: () => ({ set: (values: Record<string, unknown>) => ({ where: () => ({ returning: async () => { if (values.signedTransaction) mocks.events.push("persist"); return mocks.updates.shift() ?? []; } }) }) }),
  insert: () => ({ values: () => ({ onConflictDoNothing: mocks.insert }) }),
} }));
vi.mock("@/lib/near-server", () => ({ nearQuery: mocks.access, treasuryReader: () => ({ getExecutionByRequest: mocks.execution, previewExecute: mocks.preview }), assertSettledPayment: vi.fn(), verifyTreasuryOwner: vi.fn() }));
vi.mock("@/lib/near-sponsor-store", () => ({ acquireSponsorKey: mocks.acquire, allocateSponsorNonce: mocks.allocate, releaseSponsorKey: mocks.release }));
vi.mock("@/lib/near-read-coordinator", () => ({ invalidateNearReadCache: vi.fn() }));
import { submitPayout, type PayoutJob } from "@/lib/reimbursements/payout";
let job: PayoutJob;
beforeEach(() => {
  vi.clearAllMocks(); mocks.events.length = 0;
  const key = KeyPair.fromRandom("ed25519"); vi.stubEnv("NEAR_REIMBURSEMENT_ACCOUNT_ID", "payout.testnet"); vi.stubEnv("NEAR_REIMBURSEMENT_PRIVATE_KEY", key.toString());
  job = { id: "a".repeat(64), actor: "payout.testnet", state: "approved", treasury: "treasury.testnet", recipient: "employee.testnet", amountYocto: "1", signedTransaction: null, request: { api_version: 1, request_id: "a".repeat(64), permission_id: "7", action: { type: "Transfer", asset: { type: "NativeNear" }, receiver: "employee.testnet", amount: "1" }, deadline_ms: String(Date.now() + 60000) } } as PayoutJob;
  mocks.execution.mockResolvedValue(null); mocks.preview.mockResolvedValue({ allowed: true }); mocks.acquire.mockResolvedValue({ leaseUntil: new Date() }); mocks.allocate.mockResolvedValue("2"); mocks.release.mockResolvedValue(undefined);
  mocks.access.mockResolvedValue({ nonce: "1", permission: "FullAccess", block_hash: "1".repeat(32) });
  mocks.updates = [[job], [{ ...job, state: "submitted", transactionHash: "tx" }]];
});
describe("NEAR reimbursement broadcast safety", () => {
  it("persists exact signed bytes before broadcast and keeps ambiguity pending", async () => {
    const fetcher = vi.fn().mockResolvedValueOnce(Response.json({ result: { chain_id: "testnet" } })).mockImplementationOnce(async (_url, options) => {
      mocks.events.push("broadcast");
      const body = JSON.parse(String(options.body));
      const tx = SignedTransaction.decode(Buffer.from(body.params.signed_tx_base64, "base64"));
      expect(tx.transaction.receiverId).toBe("treasury.testnet");
      throw new Error("timeout after broadcast");
    }); vi.stubGlobal("fetch", fetcher);
    expect(await submitPayout(job)).toMatchObject({ state: "pending" });
    expect(mocks.events).toEqual(["persist", "broadcast"]);
    expect(mocks.release).toHaveBeenCalledTimes(1);
  });
  it("never signs another transaction for an already submitted job", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("unavailable")));
    expect(await submitPayout({ ...job, state: "submitted", signedTransaction: "exact-original-bytes" })).toMatchObject({ state: "pending" });
    expect(JSON.parse(String(vi.mocked(fetch).mock.calls[0][1]?.body)).params.signed_tx_base64).toBe("exact-original-bytes");
    expect(mocks.acquire).not.toHaveBeenCalled(); expect(mocks.allocate).not.toHaveBeenCalled();
  });
  it("refuses signing if the RPC is on another network", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ result: { chain_id: "mainnet" } })));
    await expect(submitPayout(job)).rejects.toThrow("testnet"); expect(mocks.acquire).not.toHaveBeenCalled();
  });
});

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
