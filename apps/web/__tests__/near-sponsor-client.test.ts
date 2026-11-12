import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sponsoredCreateCompany, sponsoredExecute, sponsoredCreateRoot, sponsoredRevokePermission } from "@/lib/near-sponsor-client";
import { sponsoredDelegate, sponsoredSigningBytes } from "@/lib/near-sponsored-action";
const employee = "a".repeat(64);
const args = { company_id: "c".repeat(64), request: { api_version: 1 as const, permission_id: "7", request_id: "b".repeat(64), deadline_ms: "1000", action: { type: "Transfer" as const, asset: { type: "NativeNear" as const }, receiver: "vendor.testnet", amount: "10" } } };
afterEach(() => vi.unstubAllGlobals());
describe("browser sponsored signing", () => {
  it("signs the NEP-461-prefixed delegate digest and submits exactly the employee payment", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(Response.json({ enabled: true, nonce: "2", maxBlockHeight: "220" })).mockResolvedValueOnce(Response.json({ outcome: { status: { SuccessValue: "IjEi" } } }));
    vi.stubGlobal("fetch", rpc);
    const signer = vi.fn(async () => `0x${"00".repeat(64)}` as `0x${string}`);
    await sponsoredExecute(employee, "shared.testnet", args, signer);
    const delegate = sponsoredDelegate(employee, "shared.testnet", args, "2", "220");
    const bytes = sponsoredSigningBytes(delegate);
    expect(Buffer.from(bytes).readUInt32LE(0)).toBe(2 ** 30 + 366);
    expect(signer).toHaveBeenCalledWith(`0x${createHash("sha256").update(bytes).digest("hex")}`);
    expect(JSON.parse(rpc.mock.calls[1][1].body)).toMatchObject({ operation: "submit", treasury: `shared.testnet#${args.company_id}`, nonce: "2", request: args.request });
    // Object property order must not change the signed bytes after server validation.
    const reordered = { request: { ...args.request, permission_id: args.request.permission_id }, company_id: args.company_id };
    expect(sponsoredSigningBytes(sponsoredDelegate(employee, "shared.testnet", reordered, "2", "220"))).toEqual(bytes);
  });
  it("returns the original outcome without prompting for another signature during recovery", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ enabled: true, outcome: { status: { SuccessValue: "IjEi" } } })));
    const signer = vi.fn();
    await sponsoredExecute(employee, "shared.testnet", args, signer);
    expect(signer).not.toHaveBeenCalled(); expect(fetch).toHaveBeenCalledTimes(1);
  });
  it("uses the direct signing flow only when sponsorship is explicitly disabled", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ enabled: false })));
    const signer = vi.fn();
    expect(await sponsoredExecute(employee, "shared.testnet", args, signer)).toBeNull(); expect(signer).not.toHaveBeenCalled();
  });
  it("propagates sponsor failures rather than silently charging the employee", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Daily quota reached" }, { status: 409 })));
    await expect(sponsoredExecute(employee, "shared.testnet", args, vi.fn())).rejects.toThrow("Daily quota");
  });
});


describe("browser company registration sponsorship", () => {
  it("returns an existing company registration without signing again", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ enabled: true, registered: true })));
    const signer = vi.fn();
    expect(await sponsoredCreateCompany(employee, { companyKey: "workspace", contractId: "shared.testnet", deposit: "200000000000000000000000" }, signer)).toEqual({ registered: true });
    expect(signer).not.toHaveBeenCalled();
  });
  it("submits registration through its own bounded sponsorship operation", async () => {
    const rpc = vi.fn().mockResolvedValueOnce(Response.json({ enabled: true, nonce: "2", maxBlockHeight: "220" })).mockResolvedValueOnce(Response.json({ outcome: { status: { SuccessValue: "" } } }));
    vi.stubGlobal("fetch", rpc);
    await sponsoredCreateCompany(employee, { companyKey: "workspace", contractId: "shared.testnet", deposit: "200000000000000000000000" }, vi.fn(async () => `0x${"00".repeat(64)}` as `0x${string}`));
    expect(JSON.parse(rpc.mock.calls[0][1].body).operation).toBe("prepare-company");
    expect(JSON.parse(rpc.mock.calls[1][1].body)).toMatchObject({ operation: "submit-company", deposit: "200000000000000000000000" });
  });
  it("never signs an excessive company deposit even if the server quotes a nonce", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ enabled: true, nonce: "2", maxBlockHeight: "220" })));
    const signer = vi.fn();
    await expect(sponsoredCreateCompany(employee, { companyKey: "workspace", contractId: "shared.testnet", deposit: "300000000000000000000000" }, signer)).rejects.toThrow("exceeds 0.2 NEAR");
    expect(signer).not.toHaveBeenCalled();
  });
});

describe("browser adapter permission sponsorship",()=>{
 const permission={treasury:"shared.testnet#"+"c".repeat(64),delegationId:"11111111-1111-4111-8111-111111111111",parentId:"7",spec:{delegate:"a".repeat(64),valid_from_ms:"0",redelegation_depth:0,rules:[{asset:{type:"NativeNear" as const},recipients:{type:"Any" as const},lifetime_limit:"10",acknowledge_unbounded_budget:false}]}};
 it("signs only a bounded child permission with zero deposit",async()=>{
  const {sponsoredCreateAdapter}=await import("@/lib/near-sponsor-client");
  const rpc=vi.fn().mockResolvedValueOnce(Response.json({enabled:true,nonce:"2",maxBlockHeight:"220"})).mockResolvedValueOnce(Response.json({outcome:{status:{SuccessValue:"Ijki"}}}));vi.stubGlobal("fetch",rpc);
  const sign=vi.fn(async()=>`0x${"00".repeat(64)}` as `0x${string}`);
  await sponsoredCreateAdapter(employee,permission,sign);
  const {sponsoredAdapterDelegate}=await import("@/lib/near-sponsored-action");
  const delegate=sponsoredAdapterDelegate(employee,permission,"2","220");
  expect(delegate.actions[0].functionCall?.deposit).toBe(0n);
  expect(sign).toHaveBeenCalledWith(`0x${createHash("sha256").update(sponsoredSigningBytes(delegate)).digest("hex")}`);
  expect(JSON.parse(rpc.mock.calls[1][1].body)).toMatchObject({operation:"submit-adapter",delegationId:permission.delegationId,parentId:"7"});
 });
 it("recovers an existing outcome without another signature",async()=>{
  const {sponsoredCreateAdapter}=await import("@/lib/near-sponsor-client");
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({enabled:true,outcome:{status:{SuccessValue:"Ijki"}}})));const sign=vi.fn();
  await sponsoredCreateAdapter(employee,permission,sign);expect(sign).not.toHaveBeenCalled();
 });
 it("never charges an unfunded employee as a fallback when sponsorship is disabled",async()=>{
  const {sponsoredCreateAdapter}=await import("@/lib/near-sponsor-client");
  vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({enabled:false})));const sign=vi.fn();
  await expect(sponsoredCreateAdapter(employee,permission,sign)).rejects.toThrow("sponsorship is disabled");expect(sign).not.toHaveBeenCalled();
 });
});

it("retains the exact adapter intent after an interrupted submit and recovers without another signature",async()=>{
 const {sponsoredCreateAdapter}=await import("@/lib/near-sponsor-client");
 const storage=new Map<string,string>();
 vi.stubGlobal("localStorage",{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
 const permission={treasury:"shared.testnet",delegationId:"11111111-1111-4111-8111-111111111111",parentId:"7",spec:{delegate:"a".repeat(64),valid_from_ms:"100",redelegation_depth:0,rules:[{asset:{type:"NativeNear" as const},recipients:{type:"Any" as const},lifetime_limit:"10",acknowledge_unbounded_budget:false}]}};
 const rpc=vi.fn().mockResolvedValueOnce(Response.json({enabled:true,nonce:"2",maxBlockHeight:"220"})).mockRejectedValueOnce(new Error("network reset")).mockResolvedValueOnce(Response.json({enabled:true,outcome:{status:{SuccessValue:"Ijki"}}}));vi.stubGlobal("fetch",rpc);
 const sign=vi.fn(async()=>`0x${"00".repeat(64)}` as `0x${string}`);
 await expect(sponsoredCreateAdapter(employee,permission,sign)).rejects.toThrow("could not be confirmed");
 await sponsoredCreateAdapter(employee,{...permission,spec:{...permission.spec,valid_from_ms:"200"}},sign);
 expect(sign).toHaveBeenCalledTimes(1);
 expect(JSON.parse(rpc.mock.calls[2][1].body).spec.valid_from_ms).toBe("100");
});

it("refuses to fall back to the zero-balance wallet when allowance sponsorship is disabled", async () => {
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({enabled:false})));
 const signer=vi.fn();
 await expect(sponsoredCreateRoot(employee,{treasury:"shared.testnet",delegationId:"12345678-1234-4234-8234-123456789012",spec:{} as import("@allocard/delegation-sdk").PermissionSpec},signer)).rejects.toThrow("temporarily unavailable");
 expect(signer).not.toHaveBeenCalled();
 await expect(sponsoredRevokePermission(employee,{treasury:"shared.testnet",permissionId:"9"},signer)).rejects.toThrow("temporarily unavailable");
 expect(signer).not.toHaveBeenCalled();
});
it("recovers an employer allowance without asking for a second signature",async()=>{
 vi.stubGlobal("fetch",vi.fn(async()=>Response.json({enabled:true,outcome:{rootPermissionId:"9"}})));
 const signer=vi.fn();
 expect(await sponsoredCreateRoot(employee,{treasury:"shared.testnet",delegationId:"12345678-1234-4234-8234-123456789012",spec:{} as import("@allocard/delegation-sdk").PermissionSpec},signer)).toEqual({rootPermissionId:"9"});
 expect(signer).not.toHaveBeenCalled();
});
