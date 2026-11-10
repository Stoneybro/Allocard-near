import type { RevocationDelegation } from "./employer-revocation";

type Permission = { id: string; issuer: string; revoked: boolean };

/** A retry can reconcile an already revoked permission without asking for a second signature. */
export async function revokeAndSyncEmployeeAgent<T>(
  permissionId: string,
  client: {
    getPermission: (id: string) => Promise<{ revoked: boolean } | null>;
    revokePermission: (id: string) => Promise<void>;
  },
  sync: () => Promise<T>,
): Promise<T> {
  const permission = await client.getPermission(permissionId);
  if (!permission) throw new Error("Agent permission was not found on-chain");
  if (!permission.revoked) await client.revokePermission(permissionId);
  return sync();
}

/** Server-side proof is required even when a caller bypasses the dashboard. */
export async function confirmEmployeeAgentRevocation(
  path: RevocationDelegation[],
  wallet: string,
  readPath: (id: string) => Promise<Permission[]>,
): Promise<void> {
  const target = path[0];
  if (!target || target.delegateeType !== "agent" || !["active", "revoked"].includes(target.status) || !target.delegationHash) {
    throw new Error("A signed agent permission is required");
  }
  const permissions = await readPath(target.delegationHash);
  if (permissions.length !== path.length || permissions.some((permission, index) => permission.id !== path[index].delegationHash) || permissions[0]?.issuer !== wallet) {
    throw new Error("On-chain agent permission does not match your delegation");
  }
  if (!permissions[0].revoked) throw new Error("Revoke the permission on-chain before marking it revoked");
}
