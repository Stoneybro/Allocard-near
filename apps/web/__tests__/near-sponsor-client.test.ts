import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { sponsoredExecute } from "@/lib/near-sponsor-client";
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
