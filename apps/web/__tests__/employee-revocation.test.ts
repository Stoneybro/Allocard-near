import { describe, expect, it, vi } from "vitest";
import { confirmEmployeeAgentRevocation, revokeAndSyncEmployeeAgent } from "@/lib/employee-revocation";
import type { RevocationDelegation } from "@/lib/employer-revocation";
const child: RevocationDelegation = { id: "child", delegatorType: "user", delegatorId: "employee", delegateeType: "agent", delegateeId: "agent", parentDelegationId: "root", status: "active", delegationHash: "2", treasuryReference: "treasury" };
const root: RevocationDelegation = { ...child, id: "root", delegatorType: "company", delegatorId: "company", delegateeType: "user", delegateeId: "employee", parentDelegationId: null, delegationHash: "1" };
const confirmed = () => [{ id: "2", issuer: "employee.testnet", revoked: true }, { id: "1", issuer: "owner.testnet", revoked: false }];

describe("employee revocation signing and persistence", () => {
  it("signs before saving and accepts only an independently confirmed revocation", async () => {
    const events: string[] = [];
    const client = { getPermission: vi.fn(async () => ({ revoked: false })), revokePermission: vi.fn(async () => { events.push("on-chain"); }) };
    const result = await revokeAndSyncEmployeeAgent("2", client, async () => { await confirmEmployeeAgentRevocation([child, root], "employee.testnet", async () => confirmed()); events.push("saved"); return "updated"; });
    expect(events).toEqual(["on-chain", "saved"]);
    expect(result).toBe("updated");
    expect(client.revokePermission).toHaveBeenCalledWith("2");
  });
  it.each(["User rejected signing", "Transaction failed", "RPC timed out"])("does not save when %s", async message => {
    const save = vi.fn();
    const client = { getPermission: vi.fn(async () => ({ revoked: false })), revokePermission: vi.fn(async () => { throw new Error(message); }) };
    await expect(revokeAndSyncEmployeeAgent("2", client, save)).rejects.toThrow(message);
    expect(save).not.toHaveBeenCalled();
  });
  it("does not save or sign when the permission cannot be read", async () => {
    const save = vi.fn(), sign = vi.fn();
    await expect(revokeAndSyncEmployeeAgent("2", { getPermission: async () => null, revokePermission: sign }, save)).rejects.toThrow("not found");
    expect(sign).not.toHaveBeenCalled(); expect(save).not.toHaveBeenCalled();
  });
  it("retries database reconciliation without signing an already revoked permission again", async () => {
    const sign = vi.fn(), save = vi.fn().mockRejectedValueOnce(new Error("Database unavailable")).mockResolvedValueOnce("updated");
    const client = { getPermission: vi.fn(async () => ({ revoked: true })), revokePermission: sign };
    await expect(revokeAndSyncEmployeeAgent("2", client, save)).rejects.toThrow("Database unavailable");
    await expect(revokeAndSyncEmployeeAgent("2", client, save)).resolves.toBe("updated");
    expect(sign).not.toHaveBeenCalled();
  });
});

describe("server-side revocation confirmation", () => {
  it("confirms the child while the parent remains active", async () => {
    const permissions = confirmed();
    await expect(confirmEmployeeAgentRevocation([child, root], "employee.testnet", async () => permissions)).resolves.toBeUndefined();
    expect(permissions[1].revoked).toBe(false);
  });
  it("rejects a still-active permission even if the client says signing succeeded", async () => {
    const permissions = confirmed(); permissions[0].revoked = false;
    await expect(confirmEmployeeAgentRevocation([child, root], "employee.testnet", async () => permissions)).rejects.toThrow("Revoke the permission on-chain");
  });
  it("rejects another employee's permission", async () => {
    await expect(confirmEmployeeAgentRevocation([child, root], "other.testnet", async () => confirmed())).rejects.toThrow("does not match");
  });
  it("rejects a mismatched permission or ancestor mapping", async () => {
    const permissions = confirmed(); permissions[1].id = "99";
    await expect(confirmEmployeeAgentRevocation([child, root], "employee.testnet", async () => permissions)).rejects.toThrow("does not match");
  });
  it("fails closed when the on-chain proof is missing", async () => {
    await expect(confirmEmployeeAgentRevocation([child, root], "employee.testnet", async () => [])).rejects.toThrow("does not match");
  });
  it("allows a confirmed retry after the saved status was already updated", async () => {
    await expect(confirmEmployeeAgentRevocation([{ ...child, status: "revoked" }], "employee.testnet", async () => [confirmed()[0]])).resolves.toBeUndefined();
  });
});
