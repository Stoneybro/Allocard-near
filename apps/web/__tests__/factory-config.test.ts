import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { utils } from "near-api-js";
const state = vi.hoisted(() => ({ account: {} as Record<string, unknown>, keys: [] as unknown[], config: {} as Record<string, unknown> }));
vi.mock("node:fs/promises", () => ({ readFile: async () => Buffer.from("factory-code") }));
vi.mock("@/lib/treasury-code", () => ({ treasuryCodeHash: async () => "treasury-hash" }));
vi.mock("@/lib/near-server", () => ({ nearQuery: async ({ request_type }: { request_type: string }) => {
  if (request_type === "view_account") return state.account;
  if (request_type === "view_access_key_list") return { keys: state.keys };
  return { result: [...Buffer.from(JSON.stringify(state.config))] };
} }));
import { verifiedFactoryConfig } from "@/lib/factory-server";
beforeEach(() => {
  vi.stubEnv("TREASURY_FACTORY_ACCOUNT_ID", "factory.testnet");
  state.account = { code_hash: utils.serialize.base_encode(createHash("sha256").update("factory-code").digest()) };
  state.keys=[];
  state.config={ schema_version: 1, treasury_code_hash: "treasury-hash", network_domain: "near:testnet", account_funding: "100", record_funding: "20", creation_deposit: "120" };
});
afterEach(() => vi.unstubAllEnvs());
describe("verified factory quotes", () => {
  it("quotes only exact factory code and the expected immutable treasury release", async () => {
    expect(await verifiedFactoryConfig()).toMatchObject({ factoryId: "factory.testnet", creation_deposit: "120" });
  });
  it("rejects retained deployment keys", async () => {
    state.keys=[{ public_key: "key" }];
    await expect(verifiedFactoryConfig()).rejects.toThrow("no retained access keys");
  });
  it("rejects a different global treasury hash", async () => {
    state.config.treasury_code_hash="other-hash";
    await expect(verifiedFactoryConfig()).rejects.toThrow("does not match");
  });
  it("rejects inconsistent setup deposits", async () => {
    state.config.creation_deposit="119";
    await expect(verifiedFactoryConfig()).rejects.toThrow("quote");
  });
});
