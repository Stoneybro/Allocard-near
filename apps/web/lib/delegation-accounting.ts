export function extractNativeAllowanceYocto(value: unknown): bigint {
  if (typeof value === "bigint") {
    return value;
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return BigInt(Math.trunc(value));
  }

  if (typeof value === "string" && /^\d+$/.test(value)) {
    return BigInt(value);
  }

  if (!value || typeof value !== "object") {
    return 0n;
  }

  const record = value as Record<string, unknown>;
  const amount =
    record.amount ??
    record.maxAmount ??
    record.allowance ??
    record.limit ??
    record.value ??
    record.valueYocto;

  return extractNativeAllowanceYocto(amount);
}


type Delegation = { id: string; status: string; delegatorType: string; delegatorId: string; parentDelegationId: string | null };
type Caveat = { delegationId: string; caveatType: string; caveatValue: unknown };
export function companyDelegatedAmount(companyId: string, delegations: Delegation[], caveats: Caveat[]): bigint {
  const roots = new Set(delegations.filter(row => row.status === "active" && row.delegatorType === "company" && row.delegatorId === companyId && row.parentDelegationId === null).map(row => row.id));
  return caveats.reduce((total, caveat) => roots.has(caveat.delegationId) && caveat.caveatType === "nativeTokenTransferAmount" ? total + extractNativeAllowanceYocto(caveat.caveatValue) : total, 0n);
}
