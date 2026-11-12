const reasons: Record<string, string> = {
  ALLOCARD_STORAGE_RESERVE_LOW: "The treasury needs more NEAR in its storage reserve to save this policy. Top up the treasury, then retry.",
  ALLOCARD_OPERATING_RESERVE_LOW: "The treasury operating reserve is too low. Top up the treasury before trying again.",
  ALLOCARD_INSUFFICIENT_AVAILABLE_FUNDS: "The treasury no longer has enough unallocated funds for this budget. Refresh the balance and lower the total budget or add funds.",
  ALLOCARD_PAUSED: "The treasury is paused. Resume it before activating an allowance.",
  ALLOCARD_UNAUTHORIZED: "This wallet cannot configure the company treasury. Sign in with its owner account.",
  ALLOCARD_INVALID_INPUT: "The treasury rejected the policy settings. Check the recipient accounts, amounts, and expiration before retrying.",
};
export function describePolicyActivationError(error: unknown) {
  const message = error instanceof Error ? error.message : "Could not activate the spending policy.";
  const code = Object.keys(reasons).find(candidate => message.includes(candidate));
  const transaction = message.match(/Transaction: ([1-9A-HJ-NP-Za-km-z]+)/)?.[1];
  return code ? `${reasons[code]} (${code})${transaction ? ` Transaction: ${transaction}` : ""}` : message;
}
