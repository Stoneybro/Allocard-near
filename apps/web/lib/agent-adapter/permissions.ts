import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { agents, companies, users } from "../db/schema";
import { requireEmployeeAgentDelegation } from "../auth-guard";
import { treasuryReader, verifyTreasuryOwner } from "../near-server";
import { adapterAccount } from "./config";
import { ADAPTER_NAME } from "./shared";
export async function authorizeAdapter(employeeId: string, wallet: string, companyId: string, delegationId: string) {
  const account = adapterAccount();
  if (!account) throw new Error("The agent signing identity has not been configured.");
  const { delegation, parentDelegation } = await requireEmployeeAgentDelegation(employeeId, delegationId);
  if (parentDelegation.delegatorId !== companyId) throw new Error("Forbidden: permission belongs to another company");
  const [agent] = await db.select().from(agents).where(and(eq(agents.id, delegation.delegateeId!), eq(agents.isActive, true))).limit(1);
  if (!agent || agent.name !== ADAPTER_NAME || agent.smartAccountAddress !== account || agent.signerAddress !== account) throw new Error("Forbidden: only the configured agent is supported");
  const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
  if (!company?.smartAccountAddress || delegation.treasuryReference !== company.smartAccountAddress || !delegation.delegationHash || !parentDelegation.delegationHash) throw new Error("Forbidden: permission is not bound to this treasury");
  const [owner] = await db.select().from(users).where(eq(users.id, company.ownerId)).limit(1);
  if (!owner) throw new Error("Forbidden: company owner missing");
  const reader = treasuryReader(company.smartAccountAddress);
  const [config, path] = await Promise.all([verifyTreasuryOwner(company.smartAccountAddress, owner.nearAccountId ?? owner.embeddedWalletAddress), reader.getPermissionPath(delegation.delegationHash)]);
  if (config.paused || path.length !== 2 || path[0].id !== delegation.delegationHash || path[0].delegate !== account || path[0].issuer !== wallet || path[0].parent_id !== parentDelegation.delegationHash || path[1].delegate !== wallet || path[1].id !== parentDelegation.delegationHash || path[1].parent_id != null || path[1].issuer !== (owner.nearAccountId ?? owner.embeddedWalletAddress)) throw new Error("Forbidden: invalid agent permission ancestry");
  const now = BigInt(Date.now());
  for (const permission of path) {
    if (permission.revoked || permission.epoch !== config.authority_epoch || BigInt(permission.valid_from_ms) > now || (permission.expires_at_ms && BigInt(permission.expires_at_ms) <= now)) throw new Error("Forbidden: agent permission expired or revoked");
    if (permission.max_executions != null) { const usage = await reader.caller.viewFunction({contractId:reader.contractId, methodName:"get_permission_usage", args:{permission_id:permission.id}}); if (!Number.isSafeInteger(usage?.executions_count) || usage.executions_count >= permission.max_executions) throw new Error("Forbidden: permission execution limit reached"); }
    for (const principal of new Set([permission.delegate, permission.issuer])) {
      if (await reader.caller.viewFunction({ contractId: reader.contractId, methodName: "is_principal_blocked", args: { account: principal } })) throw new Error("Forbidden: blocked principal");
    }
  }
  return { delegation, parentDelegation, company, account };
}
