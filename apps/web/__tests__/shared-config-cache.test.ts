import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ query: vi.fn(), hash: vi.fn() }));
vi.mock("@/lib/near-server", () => ({ nearQuery: mocks.query }));
vi.mock("@/lib/treasury-code", () => ({ sharedTreasuryCodeHash: mocks.hash, legacyTreasuryCodeHash: vi.fn() }));
beforeEach(() => {
  vi.resetModules(); vi.resetAllMocks();
  vi.stubEnv("SHARED_TREASURY_ACCOUNT_ID", "shared.testnet");
  mocks.hash.mockResolvedValue("reviewed-hash");
  mocks.query.mockImplementation(async params => {
    if (params.request_type === "view_account") return { code_hash: "reviewed-hash" };
    if (params.request_type === "view_access_key_list") return { keys: [] };
    return { result: [...Buffer.from(JSON.stringify({ schema_version: 5, network_domain: "near:testnet", creation_deposit: "200000000000000000000000" }))] };
  });
});
afterEach(() => vi.unstubAllEnvs());
it("shares successful immutable verification across concurrent calls and scopes it to the release", async () => {
  const { verifiedSharedConfig } = await import("@/lib/shared-server");
  await Promise.all([verifiedSharedConfig(), verifiedSharedConfig()]);
  await verifiedSharedConfig();
  expect(mocks.query).toHaveBeenCalledTimes(3);
  mocks.hash.mockResolvedValue("different-release");
  await expect(verifiedSharedConfig()).rejects.toThrow("match this release");
  expect(mocks.query).toHaveBeenCalledTimes(6);
});
it("never caches a failed verification or a treasury with retained keys", async () => {
  const query = mocks.query.getMockImplementation()!;
  mocks.query.mockImplementation(async params => params.request_type === "view_access_key_list" ? { keys: [{ public_key: "retained" }] } : query(params));
  const { verifiedSharedConfig } = await import("@/lib/shared-server");
  await expect(verifiedSharedConfig()).rejects.toThrow("retain no keys");
  mocks.query.mockImplementation(query);
  await expect(verifiedSharedConfig()).resolves.toMatchObject({ schema_version: 5 });
  expect(mocks.query).toHaveBeenCalledTimes(6);
});
