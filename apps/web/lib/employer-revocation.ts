/** Resolve a revocable agent branch without granting permission-editing access. */
export type RevocationDelegation = {
  id: string;
  delegatorType: string;
  delegatorId: string;
  delegateeType: string;
  delegateeId: string | null;
  parentDelegationId: string | null;
  status: string;
  delegationHash: string | null;
  treasuryReference: string | null;
};

export async function resolveEmployerRevocation<T extends RevocationDelegation>(
  targetId: string,
  companyId: string,
  treasury: string | null,
  load: (id: string) => Promise<T | undefined>,
): Promise<T[]> {
  const path: T[] = [];
  const seen = new Set<string>();
  let id: string | null = targetId;
  while (id) {
    if (seen.has(id) || path.length >= 32) throw new Error("Invalid delegation ancestry");
    seen.add(id);
    const row = await load(id);
    if (!row) throw new Error("Delegation not found");
    if (path.length === 0 && row.delegatorType !== "company" && (row.delegateeType !== "agent" || row.status !== "active")) {
      throw new Error("Only active child agents can be revoked by the employer");
    }
    if (row.status === "active" && (!treasury || row.treasuryReference !== treasury || !row.delegationHash)) {
      throw new Error("Delegation is not bound to this treasury");
    }
    const child = path.at(-1);
    if (child && (child.delegatorType !== row.delegateeType || child.delegatorId !== row.delegateeId)) {
      throw new Error("Invalid delegation issuer ancestry");
    }
    path.push(row);
    if (row.delegatorType === "company") {
      if (row.delegatorId !== companyId || row.parentDelegationId) throw new Error("Delegation belongs to another company");
      return path;
    }
    id = row.parentDelegationId;
  }
  throw new Error("Company delegation ancestry not found");
}
