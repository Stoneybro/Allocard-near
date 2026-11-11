import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({
  rows: new Map<unknown, unknown[]>(), delegationReads: [] as unknown[][],
  reader: vi.fn(), permission: vi.fn(), update: vi.fn(), session: vi.fn(),
}));
vi.mock("@/lib/auth-guard", () => ({ requireSession: mocks.session }));
vi.mock("@/lib/session", () => ({ getSessionIdentity: async () => ({ providerUserId: "privy-user", email: "employee@example.com" }) }));
vi.mock("@/lib/near-sponsor-server", () => ({ fundMockUsdcTreasury: vi.fn() }));
vi.mock("@/lib/near-server", () => ({ treasuryReader: mocks.reader, verifyTreasuryOwner: vi.fn(), assertEmployeePermission: vi.fn() }));
vi.mock("@/lib/db", async () => {
  const { delegations } = await import("@/lib/db/schema");
  const query = (table: unknown) => {
    const result = () => table === delegations ? mocks.delegationReads.shift() ?? [] : mocks.rows.get(table) ?? [];
    const chain = { where: () => chain, innerJoin: () => chain, limit: async () => result(), then: (resolve: (rows: unknown[]) => unknown) => Promise.resolve(result()).then(resolve) };
    return chain;
  };
  return { db: {
    select: () => ({ from: query }),
    execute: vi.fn(async () => ({ rows: [] })), batch: vi.fn(async () => []),
    update: mocks.update,
  } };
});
import { agents, users, companyMemberships, workspacePreferences, employeeProfiles, delegationCaveats } from "@/lib/db/schema";
import { createAgentRedelegation, activateEmployeeDelegation } from "@/app/actions/identity";
import { ADAPTER_NAME } from "@/lib/agent-adapter/shared";
const walletAddress = "employee.testnet";
const draft = { id: "child", delegatorType: "user", delegatorId: "employee", delegateeType: "agent", delegateeId: "agent", parentDelegationId: "parent", delegationHash: null, signedDelegation: null, policyPrompt: null, status: "pending_config", canvasPositionX: 420, canvasPositionY: 220, createdAt: new Date(), activatedAt: null, revokedAt: null };
const parent = { id: "parent", status: "active", delegationHash: "7" };
const permission = { id: "9", delegate: "research.testnet", issuer: walletAddress, parent_id: "7", revoked: false };
beforeEach(() => {
  vi.clearAllMocks(); mocks.rows.clear(); mocks.delegationReads = [];
  vi.stubEnv("NEAR_ADAPTER_ACCOUNT_ID", "research.testnet");
  mocks.session.mockResolvedValue(walletAddress);
  mocks.rows.set(users, [{ id: "employee", privyUserId: "privy-user", role: "employee", embeddedWalletAddress: walletAddress, verifiedEmail: "employee@example.com", smartAccountAddress: walletAddress }]);
  mocks.rows.set(companyMemberships, [{ membership: { companyId: "company", canEmployee: true, canEmployer: false }, company: { id: "company", name: "Acme", ownerId: "owner", smartAccountAddress: "treasury.testnet" } }]);
  mocks.rows.set(workspacePreferences, []); mocks.rows.set(employeeProfiles, []);
  mocks.rows.set(agents, [{ id: "agent", name: ADAPTER_NAME, isActive: true, smartAccountAddress: "research.testnet", signerAddress: "research.testnet" }]);
  mocks.rows.set(delegationCaveats, [{ id: "caveat", delegationId: draft.id, caveatType: "nativeTokenTransferAmount", caveatValue: { maxAmount: "100" }, createdAt: new Date() }]);
  mocks.permission.mockResolvedValue(permission);
  mocks.reader.mockReturnValue({ getPermission: mocks.permission });
  mocks.update.mockReturnValue({ set: (values: object) => ({ where: () => ({ returning: async () => [{ ...draft, ...values }] }) }) });
});
afterEach(() => vi.unstubAllEnvs());
it("returns only the saved setup draft without treasury or balance reads", async () => {
  mocks.delegationReads = [[parent], [draft]];
  const result = await createAgentRedelegation({ walletAddress, agentId: "agent" });
  expect(result).toMatchObject({ id: "child", status: "pending_config" });
  expect(result).not.toHaveProperty("summary");
  expect(mocks.reader).not.toHaveBeenCalled();
});
it("returns the confirmed permission after one chain verification, without rebuilding the dashboard", async () => {
  mocks.delegationReads = [[draft], [parent]];
  const result = await activateEmployeeDelegation({ walletAddress, delegationId: "child", delegationHash: "9", signedDelegation: null });
  expect(result).toMatchObject({ id: "child", status: "active", delegationHash: "9", signedDelegation: permission });
  expect(mocks.permission).toHaveBeenCalledTimes(1);
  expect(mocks.permission).toHaveBeenCalledWith("9");
  expect(result).not.toHaveProperty("summary");
});
it("still rejects a confirmed permission belonging to another agent before saving activation", async () => {
  mocks.delegationReads = [[draft], [parent]];
  mocks.permission.mockResolvedValue({ ...permission, delegate: "other.testnet" });
  await expect(activateEmployeeDelegation({ walletAddress, delegationId: "child", delegationHash: "9", signedDelegation: null })).rejects.toThrow("another adapter");
  expect(mocks.update).not.toHaveBeenCalled();
});
it("rejects a mismatched session before preparing agent setup", async () => {
  mocks.session.mockResolvedValue("other.testnet");
  await expect(createAgentRedelegation({ walletAddress, agentId: "agent" })).rejects.toThrow("Session wallet");
  expect(mocks.reader).not.toHaveBeenCalled();
});
