import { describe, it, expect, vi } from "vitest";
import { AllocardTreasuryClient, NearCaller } from "../src/client.js";
import { ExecuteRequest, PermissionSpec } from "../src/types.js";

describe("AllocardTreasuryClient", () => {
  const mockCaller: NearCaller = {
    accountId: "alice.near",
    viewFunction: vi.fn(async ({ methodName, args }) => {
      if (methodName === "get_config") {
        return {
          schema_version: 1,
          network_domain: "testnet",
          owner: "alice.near",
          authority_epoch: "1",
          paused: false,
          next_permission_id: "2",
          next_execution_id: "1",
          max_total_permissions: 1024,
          max_pending_executions: 64,
          min_operating_reserve: "100000000000000000000000",
          callback_gas: "30000000000000",
          transfer_gas: "20000000000000",
          storage_funding_remaining: "0",
          operating_budget_remaining: "0",
          pending_execution_count: 0,
        };
      }
      if (methodName === "get_execution") {
        return {
          id: args?.execution_id,
          actor: "bob.near",
          request_id: "a000000000000000000000000000000000000000000000000000000000000001",
          request_hash: "hash",
          authority_mode: "Delegated",
          permission_id: "1",
          epoch: "1",
          action: {
            type: "Transfer",
            asset: { type: "NativeNear" },
            receiver: "charlie.near",
            amount: "100",
          },
          created_at_ms: "1000",
          status: "Succeeded",
          needs_reconciliation: false,
          reservations: [],
        };
      }
      return null;
    }),
    functionCall: vi.fn(async ({ methodName }) => {
      if (methodName === "create_root_permission") {
        return "1";
      }
      if (methodName === "execute") {
        return "42";
      }
      return null;
    }),
  };

  const client = new AllocardTreasuryClient({
    contractId: "treasury.testnet",
    networkDomain: "testnet",
    caller: mockCaller,
  });

  it("fetches configuration correctly", async () => {
    const config = await client.getConfig();
    expect(config.owner).toBe("alice.near");
    expect(config.authority_epoch).toBe("1");
  });

  it("creates root permission", async () => {
    const spec: PermissionSpec = {
      delegate: "bob.near",
      valid_from_ms: "0",
      rules: [
        {
          asset: { type: "NativeNear" },
          recipients: { type: "Any" },
          lifetime_limit: "1000",
          acknowledge_unbounded_budget: false,
        },
      ],
      redelegation_depth: 1,
    };

    const permId = await client.createRootPermission(spec);
    expect(permId).toBe("1");
    expect(mockCaller.functionCall).toHaveBeenCalledWith(
      expect.objectContaining({
        contractId: "treasury.testnet",
        methodName: "create_root_permission",
      })
    );
  });

  it("executes and waits for terminal outcome", async () => {
    const request: ExecuteRequest = {
      api_version: 1,
      request_id: "a000000000000000000000000000000000000000000000000000000000000001",
      permission_id: "1",
      action: {
        type: "Transfer",
        asset: { type: "NativeNear" },
        receiver: "charlie.near",
        amount: "100",
      },
      deadline_ms: "2000000000000",
    };

    const { executionId, waitForOutcome } = await client.execute(request);
    expect(executionId).toBe("42");

    const outcome = await waitForOutcome(5000, 10);
    expect(outcome.status).toBe("Succeeded");
  });
});
