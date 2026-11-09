/** Keep an uncertain signed transaction across transport recreation and page reloads. */
export type PendingNearTransaction = { hash: string; requestKey: string };
const pending = new Map<string, PendingNearTransaction>();
const key = (account: string) => `allocard:near:testnet:pending:${account}`;
/** Operator-reviewed testnet validation rejections from before rejection tracking.
 * Never infer rejection from UNKNOWN_TRANSACTION, age, logout, or a timeout.
 */
function isReviewedRejectedAdapter(value: PendingNearTransaction) {
  const rejected = (process.env.NEXT_PUBLIC_NEAR_REJECTED_LEGACY_TX_HASHES ?? "").split(",").map(hash => hash.trim()).filter(Boolean);
  if (!rejected.includes(value.hash)) return false;
  try { return JSON.parse(value.requestKey).methodName === "create_child_permission"; }
  catch { return false; }
}
export function readPendingNearTransaction(account: string): PendingNearTransaction | null {
  try {
    if (typeof localStorage !== "undefined") {
      const raw = localStorage.getItem(key(account));
      if (raw) {
        const value = JSON.parse(raw);
        if (typeof value.hash !== "string" || typeof value.requestKey !== "string") throw new Error("Invalid pending transaction");
        pending.set(account, value);
      } else {
        // Another tab may have reconciled/reset it. Storage is authoritative.
        pending.delete(account);
      }
    }
  } catch { throw new Error("Cannot read the pending NEAR transaction. Restore browser storage before signing again."); }
  const value = pending.get(account) ?? null;
  if (value && isReviewedRejectedAdapter(value)) {
    clearPendingNearTransaction(account);
    return null;
  }
  return value;
}
export function savePendingNearTransaction(account: string, value: PendingNearTransaction) {
  if (typeof localStorage !== "undefined") localStorage.setItem(key(account), JSON.stringify(value));
  pending.set(account, value);
}
export function clearPendingNearTransaction(account: string) {
  if (typeof localStorage !== "undefined") localStorage.removeItem(key(account));
  pending.delete(account);
}
export function nearRequestKey(value: unknown) {
  return JSON.stringify(value, (name, item) => name === "valid_from_ms" ? undefined : typeof item === "bigint" ? item.toString() : item);
}
