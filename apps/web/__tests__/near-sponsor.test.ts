vi.mock("server-only", () => ({}));
import { createHash, generateKeyPairSync, sign } from "node:crypto";
import { KeyPair } from "near-api-js";
import { SignedTransaction } from "near-api-js/lib/transaction";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SponsorJob } from "@/lib/near-sponsor-store";
const mocks = vi.hoisted(() => ({
  jobs: new Map<string, SponsorJob>(), rows: new Map<unknown, unknown[]>(), query: vi.fn(), reader: vi.fn(), owner: vi.fn(),
  identity: vi.fn(), user: vi.fn(), membership: vi.fn(), quota: vi.fn(), lease: vi.fn(), release: vi.fn(), nonce: vi.fn(), shared: vi.fn(), grant: vi.fn(), active: false, registered: false, adapterRows: null as unknown[][] | null,
}));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: (table: unknown) => ({ where: () => ({ limit: async () => mocks.adapterRows ? mocks.adapterRows.shift() ?? [] : mocks.rows.get(table) ?? [] }) }) }) } }));
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
  releaseRejectedSponsorJob: async (id: string, hash: string) => { if (mocks.jobs.get(id)?.transactionHash === hash) mocks.jobs.delete(id); },
  releaseUnbroadcastJob: async (id: string) => { if (!mocks.jobs.get(id)?.transactionHash) mocks.jobs.delete(id); },
}));
import { prepareSponsoredAdapter, submitSponsoredAdapter, prepareSponsoredCompany, submitSponsoredCompany, prepareSponsoredPayment, submitSponsoredPayment, sponsoredPaymentSchema } from "@/lib/near-sponsor-server";
import { sponsoredAdapterDelegate, sponsoredCompanyDelegate, sponsoredDelegate, sponsoredSigningBytes } from "@/lib/near-sponsored-action";
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
function adapterReceipts(signed: SignedTransaction) {
 const method=signed.transaction.actions[0].signedDelegate?.delegateAction.actions[0].functionCall?.methodName;
 return method==="create_child_permission" ? [{outcome:{executor_id:"shared.testnet",status:{SuccessValue:Buffer.from(JSON.stringify("9")).toString("base64")}}}] : [];
}
function mockRpc() {
  return vi.fn(async (_url: unknown, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    if (body.method === "status") return Response.json({ result: { chain_id: "testnet" } });
    if (body.method === "gas_price") return Response.json({ result: { gas_price: "100000000" } });
    if (body.method === "tx") {
      const job = [...mocks.jobs.values()].find(job => job.transactionHash === body.params.tx_hash)!;
      return Response.json({ result: { transaction: { hash: job.transactionHash }, status: { SuccessValue: "" }, receipts_outcome: adapterReceipts(SignedTransaction.decode(Buffer.from(job.signedTransaction!,"base64"))) } });
    }
    const signed = SignedTransaction.decode(Buffer.from(body.params.signed_tx_base64, "base64"));
    const hash = [...mocks.jobs.values()].find(job => job.signedTransaction === body.params.signed_tx_base64)!.transactionHash;
    if (signed.transaction.actions[0].transfer) mocks.active = true;
    if (signed.transaction.actions[0].signedDelegate?.delegateAction.actions[0].functionCall?.methodName === "create_company") mocks.registered = true;
    return Response.json({ result: { transaction: { hash, signer_id: signed.transaction.signerId, receiver_id: signed.transaction.receiverId }, status: { SuccessValue: "" }, receipts_outcome: adapterReceipts(signed) } });
  });
}
beforeEach(() => {
  vi.resetAllMocks(); mocks.jobs.clear(); mocks.rows.clear(); mocks.active = true; mocks.registered = false; mocks.adapterRows = null;
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
    expect(mocks.quota).not.toHaveBeenCalled();
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
    expect(mocks.quota).not.toHaveBeenCalled();
  });
  it("sponsors consecutive payments despite obsolete daily limits and exhausted quota records", async () => {
    vi.stubEnv("NEAR_SPONSOR_DAILY_LIMIT", "1");
    vi.stubEnv("NEAR_SPONSOR_USER_DAILY_LIMIT", "1");
    mocks.quota.mockRejectedValue(new Error("Daily gas sponsorship limit reached"));
    await submitSponsoredPayment(proof());
    const nextPayment = { ...payment, request: { ...payment.request, request_id: "c".repeat(64) } };
    const delegate = sponsoredDelegate(employee, "shared.testnet", { request: nextPayment.request, company_id: companyId }, "2", "220");
    const digest = createHash("sha256").update(sponsoredSigningBytes(delegate)).digest();
    const signature = `0x${sign(null, digest, employeeKey.privateKey).toString("hex")}`;
    await submitSponsoredPayment({ ...nextPayment, nonce: "2", maxBlockHeight: "220", signature });
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.filter(call => JSON.parse(call[1]!.body as string).method === "send_tx")).toHaveLength(2);
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
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(mocks.quota).not.toHaveBeenCalled();
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
  it("sponsors company registration despite previously consumed owner and daily grants", async () => {
    ownerFixture();
    mocks.grant.mockRejectedValue(new Error("Owner already used one sponsored registration"));
    mocks.quota.mockRejectedValue(new Error("Daily gas sponsorship limit reached"));
    await submitSponsoredCompany(companyProof());
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(mocks.quota).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.filter(call => JSON.parse(call[1]!.body as string).method === "send_tx")).toHaveLength(1);
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
    expect(mocks.grant).not.toHaveBeenCalled();
    expect(vi.mocked(fetch).mock.calls.filter(call => JSON.parse(call[1]!.body as string).method === "send_tx")).toHaveLength(0);
  });
});

const adapterPermission = { treasury:payment.treasury,delegationId:"11111111-1111-4111-8111-111111111111",parentId:"7",spec:{delegate:"a".repeat(64),valid_from_ms:"0",expires_at_ms:null,max_executions:null,redelegation_depth:0,metadata_hash:null,rules:[{asset:{type:"NativeNear" as const},recipients:{type:"Any" as const},min_per_action:null,max_per_action:"10",lifetime_limit:"100",fixed_window:null,streaming:null,approval:null,acknowledge_unbounded_budget:false}]}};
function adapterRows(changes: Record<string,unknown> = {}) {
 const child={id:adapterPermission.delegationId,delegatorType:"user",delegatorId:"employee-id",delegateeType:"agent",delegateeId:"adapter-id",parentDelegationId:"parent-id",status:"pending_config",...changes};
 return [[{id:"company-id",ownerId:"owner-id"}],[child],[{id:"parent-id",delegatorType:"company",delegatorId:"company-id",delegateeType:"user",delegateeId:"employee-id",status:"active",delegationHash:"7",treasuryReference:payment.treasury}],[{id:"adapter-id",isActive:true,name:"Allocard Purchasing Research Adapter",smartAccountAddress:"a".repeat(64),signerAddress:"a".repeat(64)}],[{nearAccountId:"owner.testnet"}]];
}
function configureAdapter() {
 vi.stubEnv("NEAR_ADAPTER_ACCOUNT_ID","a".repeat(64));
 const root={id:"7",delegate:employee,issuer:"owner.testnet",parent_id:null,revoked:false,epoch:"1",valid_from_ms:"0",expires_at_ms:null,max_executions:null,redelegation_depth:1,rules:[{...adapterPermission.spec.rules[0],max_per_action:"100",lifetime_limit:"1000"}]};
 mocks.reader.mockReturnValue({getPermission:async(id:string)=>({id,parent_id:"7",issuer:employee,delegate:adapterPermission.spec.delegate,revoked:false}),getPermissionPath:async()=>[root],caller:{viewFunction:async()=>false},contractId:"shared.testnet"});
 return root;
}
function adapterProof() {
 const delegate=sponsoredAdapterDelegate(employee,adapterPermission,"2","220");
 const digest=createHash("sha256").update(sponsoredSigningBytes(delegate)).digest();
 return {...adapterPermission,nonce:"2",maxBlockHeight:"220",signature:`0x${sign(null,digest,employeeKey.privateKey).toString("hex")}`};
}
describe("adapter child permission gas sponsorship",()=>{
 it("quotes a nonce for a zero-balance employee without transferring them spendable funds",async()=>{
  configureAdapter();mocks.adapterRows=adapterRows();
  expect(await prepareSponsoredAdapter(adapterPermission)).toMatchObject({enabled:true,nonce:"2"});
  expect(vi.mocked(fetch).mock.calls.filter(call=>JSON.parse(call[1]!.body as string).method==="send_tx")).toHaveLength(0);
 });
 it("relays only the employee-signed child permission with zero attached deposit",async()=>{
  configureAdapter();mocks.adapterRows=adapterRows();
  const result=await submitSponsoredAdapter(adapterProof());
  expect(result.outcome.status.SuccessValue).toBe("");
  expect(result.outcome.adapterPermissionId).toBe("9");
  const broadcast=vi.mocked(fetch).mock.calls.find(call=>JSON.parse(call[1]!.body as string).method==="send_tx")!;
  const signed=SignedTransaction.decode(Buffer.from(JSON.parse(broadcast[1]!.body as string).params.signed_tx_base64,"base64"));
  expect(signed.transaction.signerId).toBe("sponsor.testnet");expect(signed.transaction.receiverId).toBe(employee);
  const delegate=signed.transaction.actions[0].signedDelegate!.delegateAction;
  expect(delegate.senderId).toBe(employee);expect(delegate.receiverId).toBe("shared.testnet");
  const action=delegate.actions[0].functionCall!;
  expect(action.methodName).toBe("create_child_permission");expect(action.deposit).toBe(0n);
  expect(JSON.parse(Buffer.from(action.args).toString())).toMatchObject({parent_id:"7",company_id:companyId,spec:{delegate:"a".repeat(64),redelegation_depth:0}});
 });
 it("recovers the original durable job without another broadcast",async()=>{
  configureAdapter();mocks.adapterRows=adapterRows();await submitSponsoredAdapter(adapterProof());
  mocks.adapterRows=adapterRows();await prepareSponsoredAdapter(adapterPermission);
  expect(vi.mocked(fetch).mock.calls.filter(call=>JSON.parse(call[1]!.body as string).method==="send_tx")).toHaveLength(1);
 });
 it("rejects another employee's child permission before signing or relaying",async()=>{
  configureAdapter();mocks.adapterRows=adapterRows({delegatorId:"other-employee"});
  await expect(prepareSponsoredAdapter(adapterPermission)).rejects.toThrow("Only your adapter");expect(mocks.jobs.size).toBe(0);
 });
 it("rejects a different adapter recipient",async()=>{
  configureAdapter();mocks.adapterRows=adapterRows();
  await expect(prepareSponsoredAdapter({...adapterPermission,spec:{...adapterPermission.spec,delegate:"evil.testnet"}})).rejects.toThrow("configured Allocard adapter");expect(mocks.jobs.size).toBe(0);
 });
 it("rejects widened child budgets before consuming relayer gas",async()=>{
  configureAdapter();mocks.adapterRows=adapterRows();
  await expect(prepareSponsoredAdapter({...adapterPermission,spec:{...adapterPermission.spec,rules:[{...adapterPermission.spec.rules[0],lifetime_limit:"1001"}]}})).rejects.toThrow("parent spending limits");expect(mocks.jobs.size).toBe(0);
 });
 it("rejects a forged signature before creating a sponsor job",async()=>{
  configureAdapter();mocks.adapterRows=adapterRows();
  await expect(submitSponsoredAdapter({...adapterProof(),signature:`0x${"00".repeat(64)}`})).rejects.toThrow("Invalid adapter permission meta-transaction signature");expect(mocks.jobs.size).toBe(0);
 });
 it("rejects revoked on-chain parent permissions",async()=>{
  const root=configureAdapter();root.revoked=true;mocks.adapterRows=adapterRows();
  await expect(prepareSponsoredAdapter(adapterPermission)).rejects.toThrow("expired or revoked");expect(mocks.jobs.size).toBe(0);
 });
});

it("recovers a confirmed adapter's inner receipt instead of issuing a replacement when its first response is incomplete",async()=>{
 configureAdapter();mocks.adapterRows=adapterRows();
 const base=mockRpc();
 const rpc=vi.fn(async(url:unknown,options:RequestInit)=>{
  const response=await base(url,options);const data=await response.json();
  if(JSON.parse(options.body as string).method==="send_tx")delete data.result.receipts_outcome;
  return Response.json(data);
 });
 vi.stubGlobal("fetch",rpc);
 await expect(submitSponsoredAdapter(adapterProof())).rejects.toThrow("child permission result is not available");
 expect(mocks.jobs.size).toBe(1);
 mocks.adapterRows=adapterRows();
 expect((await prepareSponsoredAdapter(adapterPermission)).outcome?.adapterPermissionId).toBe("9");
 expect(rpc.mock.calls.filter(call=>JSON.parse(call[1].body as string).method==="send_tx")).toHaveLength(1);
});

it("credits activation once and accepts consecutive faucet claims without daily quotas", async () => {
  vi.stubEnv("NEXT_PUBLIC_MOCK_USDC_ACCOUNT_ID", "mock-usdc.testnet");
  vi.resetModules();
  const { computeCompanyId } = await import("@allocard/delegation-sdk");
  const { fundMockUsdcTreasury } = await import("@/lib/near-sponsor-server");
  const { sponsoredCompanyDelegate } = await import("@/lib/near-sponsored-action");
  const companyKey = "6aee788b-c3c6-44e4-bd88-a3029091bec4";
  const scopedCompany = computeCompanyId(employee, companyKey);
  const treasury = `shared.testnet#${scopedCompany}`;
  const create = sponsoredCompanyDelegate(employee, {
    companyKey, contractId: "shared.testnet", deposit: "200000000000000000000000",
  }, "2", "220");
  expect(create.actions.map(action => action.functionCall?.methodName))
    .toEqual(["create_company", "register_asset", "set_asset_enabled"]);
  mocks.reader.mockReturnValue({ getAssetLedger: async () => ({ enabled: true }) });
  const query = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async params => {
    const responses: Record<string, unknown> = {
      get_minter: "sponsor.testnet",
      storage_balance_bounds: { min: "1250000000000000000000" },
      storage_balance_of: { total: "1250000000000000000000" },
    };
    if (params.method_name in responses) {
      return { result: [...Buffer.from(JSON.stringify(responses[params.method_name]))] };
    }
    return query(params);
  });
  const base = mockRpc();
  const rpc = vi.fn(async (url: unknown, options: RequestInit) => {
    const body = JSON.parse(options.body as string);
    const response = await base(url, options);
    const result = await response.json();
    if (body.method === "send_tx" || body.method === "tx") {
      const encoded = body.method === "send_tx" ? body.params.signed_tx_base64
        : [...mocks.jobs.values()].find(job => job.transactionHash === body.params.tx_hash)?.signedTransaction;
      const transaction = SignedTransaction.decode(Buffer.from(encoded, "base64")).transaction;
      const deposit = transaction.actions.find(action => action.functionCall?.methodName === "ft_transfer_call")?.functionCall;
      if (deposit) {
        const args = JSON.parse(Buffer.from(deposit.args).toString("utf8"));
        expect(args.receiver_id).toBe("shared.testnet");
        expect(JSON.parse(args.msg)).toEqual({ company_id: scopedCompany });
        result.result.status.SuccessValue = Buffer.from(JSON.stringify(args.amount)).toString("base64");
      }
    }
    return Response.json(result);
  });
  vi.stubGlobal("fetch", rpc);

  const claim = (claimId: string) => fundMockUsdcTreasury({ owner: employee, companyId: companyKey, treasury, claimId });
  const activation = await claim("activation");
  expect(activation.amount).toBe("2000000000");
  await expect(claim("activation")).resolves.toEqual(activation);
  const first = "f0ab27b2-d4c3-43b2-adac-0ea6480d7511";
  const second = "a1ab27b2-d4c3-43b2-adac-0ea6480d7511";
  const topUp = await claim(first);
  expect(topUp.amount).toBe("1000000000");
  await expect(claim(first)).resolves.toEqual(topUp);
  expect((await claim(second)).amount).toBe("1000000000");
  expect(mocks.quota).not.toHaveBeenCalled();
  expect(rpc.mock.calls.filter(call => JSON.parse(call[1].body as string).method === "send_tx")).toHaveLength(4);
});

it.each(["employee", "owner", "agent"])("still rejects a blocked %s when checking principals concurrently", async role => {
 const root = configureAdapter(); mocks.adapterRows = adapterRows();
 const blockedAccount = role === "employee" ? employee : role === "owner" ? "owner.testnet" : adapterPermission.spec.delegate;
 const lookup = vi.fn(async ({ args }: { args: { account: string } }) => args.account === blockedAccount);
 mocks.reader.mockReturnValue({ getPermissionPath: async () => [root], caller: { viewFunction: lookup }, contractId: "shared.testnet" });
 await expect(prepareSponsoredAdapter(adapterPermission)).rejects.toThrow("Permission principal is blocked");
 expect(new Set(lookup.mock.calls.map(([input]) => input.args.account))).toEqual(new Set([employee, "owner.testnet", adapterPermission.spec.delegate]));
 expect(mocks.jobs.size).toBe(0);
});
