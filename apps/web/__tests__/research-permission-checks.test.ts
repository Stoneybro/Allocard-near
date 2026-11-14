import { beforeEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ rows: [] as unknown[][], bindings: vi.fn(), view: vi.fn(), owner: vi.fn(), path: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: () => { const query = { from: () => query, where: () => query, limit: async () => mocks.rows.shift() ?? [] }; return query; } } }));
vi.mock("@/lib/auth-guard", () => ({ requireEmployeeAgentDelegation: mocks.bindings }));
vi.mock("@/lib/agent-adapter/config", () => ({ adapterAccount: () => "agent.testnet" }));
vi.mock("@/lib/near-server", () => ({ verifyTreasuryOwner: mocks.owner, treasuryReader: () => ({ contractId: "treasury.testnet", getPermissionPath: mocks.path, caller: { viewFunction: mocks.view } }) }));
import { authorizeAdapter } from "@/lib/agent-adapter/permissions";
import { ADAPTER_NAME } from "@/lib/agent-adapter/shared";
beforeEach(() => {
 vi.clearAllMocks();
 mocks.rows = [[{ name: ADAPTER_NAME, smartAccountAddress: "agent.testnet", signerAddress: "agent.testnet" }], [{ id: "company", ownerId: "owner", smartAccountAddress: "treasury.testnet" }], [{ nearAccountId: "owner.testnet" }]];
 mocks.bindings.mockResolvedValue({ delegation: { delegateeId: "agent", delegationHash: "2", treasuryReference: "treasury.testnet" }, parentDelegation: { delegatorId: "company", delegationHash: "1" } });
 mocks.owner.mockResolvedValue({ owner: "owner.testnet", authority_epoch: "1", paused: false });
 mocks.path.mockResolvedValue([
  { id: "2", delegate: "agent.testnet", issuer: "employee.testnet", parent_id: "1", revoked: false, epoch: "1", valid_from_ms: "0", max_executions: 3 },
  { id: "1", delegate: "employee.testnet", issuer: "owner.testnet", parent_id: null, revoked: false, epoch: "1", valid_from_ms: "0", max_executions: 5 },
 ]);
 mocks.view.mockImplementation(async ({ methodName }) => methodName === "get_permission_usage" ? { executions_count: 0 } : false);
});
it("checks both execution limits and each distinct principal once", async () => {
 await authorizeAdapter("employee", "employee.testnet", "company", "delegation");
 expect(mocks.view.mock.calls.filter(([args]) => args.methodName === "get_permission_usage")).toHaveLength(2);
 expect(mocks.view.mock.calls.filter(([args]) => args.methodName === "is_principal_blocked").map(([args]) => args.args.account).sort()).toEqual(["agent.testnet", "employee.testnet", "owner.testnet"]);
});
it.each(["agent.testnet", "employee.testnet", "owner.testnet"])("rejects a blocked %s before research", async blocked => {
 mocks.view.mockImplementation(async ({ methodName, args }) => methodName === "get_permission_usage" ? { executions_count: 0 } : args.account === blocked);
 await expect(authorizeAdapter("employee", "employee.testnet", "company", "delegation")).rejects.toThrow("blocked principal");
});
it.each(["1", "2"])("rejects exhausted permission %s", async exhausted => {
 mocks.view.mockImplementation(async ({ methodName, args }) => methodName === "get_permission_usage" ? { executions_count: args.permission_id === exhausted ? 5 : 0 } : false);
 await expect(authorizeAdapter("employee", "employee.testnet", "company", "delegation")).rejects.toThrow("execution limit");
});
it("fails closed if a live permission read fails", async () => {
 mocks.view.mockRejectedValue(new Error("RPC unavailable"));
 await expect(authorizeAdapter("employee", "employee.testnet", "company", "delegation")).rejects.toThrow("RPC unavailable");
});
