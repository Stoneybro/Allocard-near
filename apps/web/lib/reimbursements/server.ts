import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "../db";
import { agents, companies, delegations, delegationCaveats } from "../db/schema";
import { treasuryReader } from "../near-server";
import { readLiveNativeCapacity } from "../live-capacity";
import { reimbursementSigner } from "./config";
import { REIMBURSEMENT_SERVICE_NAME, findReimbursementDelegation, reimbursementStatus, type ReimbursementProgram } from "./shared";

export async function loadReimbursementProgram(companyId: string) {
  const signer = reimbursementSigner();
  const [agent] = await db.select().from(agents).where(and(eq(agents.name, REIMBURSEMENT_SERVICE_NAME), eq(agents.isActive, true), eq(agents.smartAccountAddress, signer?.accountId ?? ""))).limit(1);
  const rows = agent ? await db.select().from(delegations).where(and(eq(delegations.delegatorType, "company"), eq(delegations.delegatorId, companyId), eq(delegations.delegateeType, "agent"), eq(delegations.delegateeId, agent.id))) : [];
  const delegation = findReimbursementDelegation(rows, companyId, agent?.id ?? null);
  const configured = !!signer && agent?.smartAccountAddress === signer.accountId && agent.signerAddress === signer.accountId;
  const program: ReimbursementProgram = { status: configured ? reimbursementStatus(agent?.id ?? null, delegation) : "unavailable", agentId: agent?.id ?? null, delegationId: delegation?.id ?? null, remainingAmount: null };
  const caveats = delegation ? await db.select().from(delegationCaveats).where(eq(delegationCaveats.delegationId, delegation.id)) : [];
  if (program.status === "ready" && delegation && signer) {
    const [company] = await db.select().from(companies).where(eq(companies.id, companyId)).limit(1);
    if (!company?.smartAccountAddress || delegation.treasuryReference !== company.smartAccountAddress || !/^[0-9]+$/.test(delegation.delegationHash ?? "")) program.status = "unavailable";
    else {
      try {
        const reader = treasuryReader(company.smartAccountAddress);
        const permission = await reader.getPermission(delegation.delegationHash!);
        if (permission?.parent_id != null || permission?.delegate !== signer.accountId) throw new Error("Wrong reimbursement authority");
        const capacity = await readLiveNativeCapacity(reader, signer.accountId, delegation.delegationHash!);
        program.remainingAmount = capacity.remainingNear;
        if (Number(capacity.remainingNear) <= 0) program.status = "exhausted";
      } catch { program.status = "unavailable"; }
    }
  }
  return { program, agent, delegation, caveats };
}
