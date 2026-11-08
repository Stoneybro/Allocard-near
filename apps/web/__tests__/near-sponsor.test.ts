import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { KeyPair } from "near-api-js";
import { SignedTransaction } from "near-api-js/lib/transaction";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SponsorJob } from "@/lib/near-sponsor-store";
const mocks = vi.hoisted(() => ({
  jobs: new Map<string, SponsorJob>(), rows: new Map<unknown, unknown[]>(), query: vi.fn(), reader: vi.fn(), owner: vi.fn(),
  identity: vi.fn(), user: vi.fn(), membership: vi.fn(), quota: vi.fn(), lease: vi.fn(), release: vi.fn(), nonce: vi.fn(), shared: vi.fn(), grant: vi.fn(), active: false, registered: false,
}));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => mocks.rows.get(table) ?? [] }) }) }) } }));
vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: mocks.user, requireEmployeeCompany: mocks.membership }));
vi.mock("@/lib/shared-server", () => ({ verifiedSharedConfig: mocks.shared }));
vi.mock("@/lib/session", () => ({ getSessionIdentity: mocks.identity }));
vi.mock("@/lib/near-server", async importOriginal => ({ ...await importOriginal<object>(), nearQuery: mocks.query, treasuryReader: mocks.reader, verifyTreasuryOwner: mocks.owner }));
vi.mock("@/lib/near-sponsor-store", () => ({
  findSponsorJob: async (id: string) => mocks.jobs.get(id) ?? null,
  claimSponsorJob: async (input: SponsorJob) => {
    if (mocks.jobs.has(input.id)) return null;
    const job = { ...input, state: "reserved", transactionHash: null, signedTransaction: null, createdAt: new Date() };
    mocks.jobs.set(input.id, job); return job;
  },
  takeCompanyRegistrationGrant: mocks.grant, takeSponsorQuota: mocks.quota, acquireSponsorKey: mocks.lease, releaseSponsorKey: mocks.release, allocateSponsorNonce: mocks.nonce,
  saveSponsorTransaction: async (id: string, transactionHash: string, signedTransaction: string) => { Object.assign(mocks.jobs.get(id)!, { transactionHash, signedTransaction, state: "submitted" }); },
  finishSponsorJob: async (id: string, state: string) => { Object.assign(mocks.jobs.get(id)!, { state }); },
  releaseUnbroadcastJob: async (id: string) => { if (!mocks.jobs.get(id)?.transactionHash) mocks.jobs.delete(id); },
}));
import { prepareSponsoredCompany, submitSponsoredCompany, prepareSponsoredPayment, submitSponsoredPayment, sponsoredPaymentSchema } from "@/lib/near-sponsor-server";
import { sponsoredCompanyDelegate, sponsoredDelegate, sponsoredSigningBytes } from "@/lib/near-sponsored-action";
import { companies, companyMemberships, delegations, users } from "@/lib/db/schema";
import { NearReadError } from "@/lib/near-read-error";
const employeeKey = generateKeyPairSync("ed25519");
const employee = employeeKey.publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("hex");
const relayer = KeyPair.fromRandom("ed25519");
const companyId = "c".repeat(64);
const payment = { treasury: `shared.testnet#${companyId}`, request: { api_version: 1 as const, permission_id: "7", request_id: "b".repeat(64), action: { type: "Transfer" as const, asset: { type: "NativeNear" as const }, receiver: "vendor.testnet", amount: "10" }, deadline_ms: String(Date.now() + 900000) } };
function proof(nonce = "2", height = "220") {
  const delegate = sponsoredDelegate(employee, "shared.testnet", { request: payment.request, company_id: companyId }, nonce, height);
  const digest = createHash("sha256").update(sponsoredSigningBytes(delegate)).digest();
  return { ...payment, nonce, maxBlockHeight: height, signature: `0x${sign(null, digest, employeeKey.privateKey).toString("hex")}` };
}
function mockRpc() {
  return vi.fn(async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    if (body.method === "status") return Response.json({ result: { chain_id: "testnet" } });
    if (body.method === "gas_price") return Response.json({ result: { gas_price: "100000000" } });
    if (body.method === "tx") {
      const job = [...mocks.jobs.values()].find(job => job.transactionHash === body.params.tx_hash)!;
      return Response.json({ result: { transaction: { hash: job.transactionHash }, status: { SuccessValue: "" } } });
    }
    const signed = SignedTransaction.decode(Buffer.from(body.params.signed_tx_base64, "base64"));
    const hash = [...mocks.jobs.values()].find(job => job.signedTransaction === body.params.signed_tx_base64)!.transactionHash;
    if (signed.transaction.actions[0].transfer) mocks.active = true;
    if (signed.transaction.actions[0].signedDelegate?.delegateAction.actions[0].functionCall?.methodName === "create_company") mocks.registered = true;
    return Response.json({ result: { transaction: { hash, signer_id: signed.transaction.signerId, receiver_id: signed.transaction.receiverId }, status: { SuccessValue: "" } } });
  });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.jobs.clear(); mocks.rows.clear(); mocks.active = true; mocks.registered = false;
  vi.stubEnv("NEAR_SPONSOR_COMPANY_ENABLED", "true");
  vi.stubEnv("NEAR_SPONSOR_ENABLED", "true"); vi.stubEnv("NEAR_RELAYER_ACCOUNT_ID", "sponsor.testnet"); vi.stubEnv("NEAR_RELAYER_PRIVATE_KEY", relayer.toString());
  mocks.identity.mockResolvedValue({ walletAddress: employee, providerUserId: "did:privy:employee" });
  mocks.user.mockResolvedValue({ id: "employee-id", privyUserId: "did:privy:employee" });
  mocks.rows.set(companies, [{ id: "company-id", ownerId: "owner-id" }]); mocks.rows.set(delegations, [{ id: "delegation-id" }]); mocks.rows.set(users, [{ nearAccountId: "owner.testnet" }]);
  mocks.shared.mockResolvedValue({ contractId: "shared.testnet", creation_deposit: "200000000000000000000000" });
  mocks.grant.mockResolvedValue(undefined);
  mocks.owner.mockResolvedValue({ owner: "owner.testnet", authority_epoch: "1" });
  mocks.reader.mockReturnValue({ getPermission: async () => ({ delegate: employee, issuer: "owner.testnet", parent_id: null, revoked: false, epoch: "1" }), previewExecute: async () => ({ allowed: true }) });
  mocks.lease.mockResolvedValue({ leaseUntil: new Date() }); mocks.nonce.mockResolvedValue("21"); mocks.release.mockResolvedValue(undefined); mocks.quota.mockResolvedValue(undefined);
  mocks.query.mockImplementation(async params => {
    if (params.method_name === "company_exists") return { result: [...Buffer.from(JSON.stringify(mocks.registered))] };
    if (params.request_type === "view_account" && params.account_id === "sponsor.testnet") return { amount: "100000000000000000000000000", storage_usage: 0 };
    if (params.request_type === "view_account" && params.account_id === employee && !mocks.active) throw new NearReadError("view_account", "UNKNOWN_ACCOUNT", "missing");
    return { permission: "FullAccess", nonce: "1", block_hash: "1".repeat(32), block_height: 100 };
  });
  vi.stubGlobal("fetch", mockRpc());
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });
describe("bounded employee gas sponsorship", () => {
  it("identifies a missing server key without exposing credentials", async () => {
    vi.stubEnv("NEAR_RELAYER_PRIVATE_KEY", "");
    await expect(prepareSponsoredPayment(payment)).rejects.toThrow("NEAR_RELAYER_PRIVATE_KEY is empty or missing");
    expect(mocks.jobs.size).toBe(0);
  });
  it("identifies a mismatched relayer key separately from the employee wallet", async () => {
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async params => {
      if (params.request_type === "view_access_key" && params.account_id === "sponsor.testnet") throw new NearReadError("view_access_key", "UNKNOWN_ACCESS_KEY", "missing");
      return query(params);
    });
    await expect(submitSponsoredPayment(proof())).rejects.toThrow("relayer signing key is not registered on sponsor.testnet");
    expect(vi.mocked(fetch).mock.calls.filter(call => JSON.parse(call[1]!.body as string).method === "send_tx")).toHaveLength(0);
  });

  it("creates a missing implicit account with one zero-value transfer before quoting its nonce", async () => {
    mocks.active = false;
    expect(await prepareSponsoredPayment(payment)).toMatchObject({ enabled: true, nonce: "2", maxBlockHeight: "220" });
    const activation = [...mocks.jobs.values()][0];
    const signed = SignedTransaction.decode(Buffer.from(activation.signedTransaction!, "base64"));
    expect(signed.transaction.receiverId).toBe(employee);
    expect(signed.transaction.actions).toHaveLength(1);
    expect(signed.transaction.actions[0].transfer!.deposit).toBe(0n);
  });
  it("relays a real employee signature with zero attached deposit and a fixed gas limit", async () => {
    const result = await submitSponsoredPayment(proof());
    expect(result.outcome.transaction.signer_id).toBe("sponsor.testnet");
    const signed = SignedTransaction.decode(Buffer.from([...mocks.jobs.values()][0].signedTransaction!, "base64"));
    const delegate = signed.transaction.actions[0].signedDelegate!.delegateAction;
    expect(signed.transaction.receiverId).toBe(employee);
    expect(delegate.senderId).toBe(employee); expect(delegate.receiverId).toBe("shared.testnet");
    expect(delegate.actions[0].functionCall!.gas).toBe(150000000000000n);
    expect(delegate.actions[0].functionCall!.deposit).toBe(0n);
    expect(mocks.membership).toHaveBeenCalledWith("employee-id", "company-id");
  });
  it("rejects a forged employee signature before spending sponsor gas", async () => {
    await expect(submitSponsoredPayment({ ...proof(), signature: `0x${"00".repeat(64)}` })).rejects.toThrow("Invalid employee");
    expect(mocks.quota).not.toHaveBeenCalled(); expect(mocks.jobs.size).toBe(0);
  });
  it("rejects signatures reused for another amount or company", async () => {
    const original = proof();
    await expect(submitSponsoredPayment({ ...original, request: { ...original.request, action: { ...original.request.action, amount: "11" } } })).rejects.toThrow("Invalid employee");
    await expect(submitSponsoredPayment({ ...original, treasury: `shared.testnet#${"d".repeat(64)}` })).rejects.toThrow("Invalid employee");
    expect(mocks.quota).not.toHaveBeenCalled();
  });
  it("does not sponsor stale nonces or excessive validity windows", async () => {
    await expect(submitSponsoredPayment(proof("3"))).rejects.toThrow("nonce changed");
    await expect(submitSponsoredPayment(proof("2", "999"))).rejects.toThrow("validity window");
    expect(mocks.jobs.size).toBe(0);
  });
  it("checks membership before account activation or sponsorship", async () => {
    mocks.membership.mockRejectedValue(new Error("Forbidden")); mocks.active = false;
    await expect(prepareSponsoredPayment(payment)).rejects.toThrow("Forbidden");
    expect(mocks.query).not.toHaveBeenCalled(); expect(mocks.jobs.size).toBe(0);
  });
  it("never activates an existing account whose signing key was removed", async () => {
    mocks.query.mockRejectedValue(new NearReadError("view_access_key", "UNKNOWN_ACCESS_KEY", "missing key"));
    await expect(prepareSponsoredPayment(payment)).rejects.toThrow("missing key");
    expect(mocks.jobs.size).toBe(0);
  });
  it("reconciles the original transaction on retry instead of resubmitting", async () => {
    await submitSponsoredPayment(proof());
    const sendCount = vi.mocked(fetch).mock.calls.filter(call => JSON.parse(call[1]!.body as string).method === "send_tx").length;
    await prepareSponsoredPayment(payment);
    expect(vi.mocked(fetch).mock.calls.filter(call => JSON.parse(call[1]!.body as string).method === "send_tx")).toHaveLength(sendCount);
    expect(mocks.quota).toHaveBeenCalledTimes(1);
    await expect(prepareSponsoredPayment({ ...payment, request: { ...payment.request, action: { ...payment.request.action, amount: "11" } } })).rejects.toThrow("different payment details");
  });
  it("preserves the exact transaction after an uncertain broadcast", async () => {
    const rpc = mockRpc();
    vi.stubGlobal("fetch", vi.fn(async (url, options: RequestInit) => {
      if (JSON.parse(options.body as string).method === "send_tx") throw new Error("timeout");
      return rpc(url, options);
    }));
    await expect(submitSponsoredPayment(proof())).rejects.toThrow("not yet confirmed");
    expect([...mocks.jobs.values()][0].transactionHash).toBeTruthy();
    vi.stubGlobal("fetch", mockRpc());
    await prepareSponsoredPayment(payment);
    expect(mocks.quota).toHaveBeenCalledTimes(1);
  });
  it("does not broadcast after a quota rejection and allows an unbroadcast intent to be retried", async () => {
    mocks.quota.mockRejectedValueOnce(new Error("Daily limit reached"));
    await expect(submitSponsoredPayment(proof())).rejects.toThrow("Daily limit");
    expect(mocks.jobs.size).toBe(0);
    expect(vi.mocked(fetch).mock.calls.filter(call => JSON.parse(call[1]!.body as string).method === "send_tx")).toHaveLength(0);
  });
  it("refuses sponsorship on a mainnet RPC", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ result: { chain_id: "mainnet" } })));
    await expect(prepareSponsoredPayment(payment)).rejects.toThrow("only enabled for NEAR testnet");
    expect(mocks.jobs.size).toBe(0);
  });
  it("rejects revoked permissions before paying for account activation", async () => {
    mocks.active = false;
    mocks.reader.mockReturnValue({ getPermission: async () => ({ delegate: employee, issuer: "owner.testnet", parent_id: null, revoked: true, epoch: "1" }) });
    await expect(prepareSponsoredPayment(payment)).rejects.toThrow("On-chain employee permission");
    expect(mocks.jobs.size).toBe(0);
  });
  it("rejects arbitrary actions and additional sponsorship fields", () => {
    expect(sponsoredPaymentSchema.safeParse({ ...payment, request: { ...payment.request, action: { type: "DeleteAccount" } } }).success).toBe(false);
    expect(sponsoredPaymentSchema.safeParse({ ...payment, gas: "300000000000000", deposit: "100" }).success).toBe(false);
  });
});


const company = { companyKey: "00000000-0000-4000-8000-000000000007", contractId: "shared.testnet", deposit: "200000000000000000000000" };
function ownerFixture() {
  mocks.rows.set(companies, [{ id: company.companyKey, ownerId: "employee-id", smartAccountAddress: null }]);
  mocks.rows.set(companyMemberships, [{ id: "membership" }]);
}
function companyProof() {
  const nonce = "2", maxBlockHeight = "220";
  const delegate = sponsoredCompanyDelegate(employee, company, nonce, maxBlockHeight);
  const digest = createHash("sha256").update(sponsoredSigningBytes(delegate)).digest();
  return { ...company, nonce, maxBlockHeight, signature: `0x${sign(null, digest, employeeKey.privateKey).toString("hex")}` };
}
describe("company owner activation and registration sponsorship", () => {
  it("initializes a new owner account before quoting company registration", async () => {
    ownerFixture(); mocks.active = false;
    expect(await prepareSponsoredCompany(company)).toMatchObject({ enabled: true, nonce: "2" });
    const signed = SignedTransaction.decode(Buffer.from([...mocks.jobs.values()][0].signedTransaction!, "base64"));
    expect(signed.transaction.actions[0].transfer!.deposit).toBe(0n);
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("preserves the owner as the inner sender and attaches only the exact registration deposit", async () => {
    ownerFixture();
    await submitSponsoredCompany(companyProof());
    const signed = SignedTransaction.decode(Buffer.from([...mocks.jobs.values()][0].signedTransaction!, "base64"));
    const delegate = signed.transaction.actions[0].signedDelegate!.delegateAction;
    expect(delegate.senderId).toBe(employee); expect(delegate.receiverId).toBe("shared.testnet");
    const call = delegate.actions[0].functionCall!;
    expect(call.methodName).toBe("create_company"); expect(call.gas).toBe(70000000000000n);
    expect(call.deposit).toBe(200000000000000000000000n);
    expect(JSON.parse(Buffer.from(call.args).toString())).toEqual({ company_key: company.companyKey });
    expect(mocks.grant).toHaveBeenCalledTimes(1);
    expect(mocks.quota).toHaveBeenCalledWith(employee, 5, 1, "company-registration");
  });
  it("reuses an existing registration without signing or paying another deposit", async () => {
    ownerFixture(); mocks.registered = true; mocks.active = false;
    expect(await prepareSponsoredCompany(company)).toEqual({ enabled: true, registered: true });
    expect(mocks.jobs.size).toBe(0); expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("does not bootstrap another owner's workspace", async () => {
    ownerFixture(); mocks.rows.set(companies, [{ id: company.companyKey, ownerId: "someone-else" }]); mocks.active = false;
    await expect(prepareSponsoredCompany(company)).rejects.toThrow("workspace's owner");
    expect(mocks.jobs.size).toBe(0);
  });
  it("requires active employer membership", async () => {
    ownerFixture(); mocks.rows.set(companyMemberships, []);
    await expect(prepareSponsoredCompany(company)).rejects.toThrow("Active employer membership");
    expect(mocks.jobs.size).toBe(0);
  });
  it("rejects a different target, incorrect deposit, or changed owner signature", async () => {
    ownerFixture();
    await expect(prepareSponsoredCompany({ ...company, contractId: "evil.testnet" })).rejects.toThrow("verified shared contract");
    await expect(prepareSponsoredCompany({ ...company, deposit: "1" })).rejects.toThrow("exact registration deposit");
    await expect(submitSponsoredCompany({ ...companyProof(), signature: `0x${"00".repeat(64)}` })).rejects.toThrow("Invalid company owner");
    expect(mocks.grant).not.toHaveBeenCalled();
  });
  it("does not consume the registration grant when the relayer cannot afford the deposit", async () => {
    ownerFixture();
    const query = mocks.query.getMockImplementation()!;
    mocks.query.mockImplementation(async params => params.request_type === "view_account" && params.account_id === "sponsor.testnet" ? { amount: "1", storage_usage: 0 } : query(params));
    await expect(submitSponsoredCompany(companyProof())).rejects.toThrow("Fund the relayer");
    expect(mocks.grant).not.toHaveBeenCalled(); expect(mocks.jobs.size).toBe(0);
  });
  it("requires a separate opt-in for sponsoring the registration deposit", async () => {
    ownerFixture(); vi.stubEnv("NEAR_SPONSOR_COMPANY_ENABLED", "false");
    await expect(prepareSponsoredCompany(company)).rejects.toThrow("not enabled");
    expect(mocks.jobs.size).toBe(0);
  });
  it("does not broadcast when the one-time owner grant has already been consumed", async () => {
    ownerFixture(); mocks.grant.mockRejectedValue(new Error("Owner already used one sponsored registration"));
    await expect(submitSponsoredCompany(companyProof())).rejects.toThrow("already used");
    expect(vi.mocked(fetch).mock.calls.filter(call => JSON.parse(call[1]!.body as string).method === "send_tx")).toHaveLength(0);
  });
  it("only reconciles an uncertain registration rather than paying the deposit twice", async () => {
    ownerFixture(); const rpc = mockRpc();
    vi.stubGlobal("fetch", vi.fn(async (url, options: RequestInit) => {
      if (JSON.parse(options.body as string).method === "send_tx") throw new Error("timeout");
      return rpc(url, options);
    }));
    await expect(submitSponsoredCompany(companyProof())).rejects.toThrow("not yet confirmed");
    vi.stubGlobal("fetch", mockRpc());
    await prepareSponsoredCompany(company);
    expect(mocks.grant).toHaveBeenCalledTimes(1);
    expect(vi.mocked(fetch).mock.calls.filter(call => JSON.parse(call[1]!.body as string).method === "send_tx")).toHaveLength(0);
  });
});
