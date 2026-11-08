import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sponsoredCreateCompany, sponsoredExecute } from "@/lib/near-sponsor-client";
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
