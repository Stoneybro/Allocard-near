/** Keep an uncertain signed transaction across transport recreation and page reloads. */
export type PendingNearTransaction = { hash: string; requestKey: string };
const pending = new Map<string, PendingNearTransaction>();
const key = (account: string) => `allocard:near:testnet:pending:${account}`;
export function readPendingNearTransaction(account: string): PendingNearTransaction | null {
  try {
    const raw = typeof localStorage !== "undefined" ? localStorage.getItem(key(account)) : null;
    if (raw) {
      const value = JSON.parse(raw);
      if (typeof value.hash !== "string" || typeof value.requestKey !== "string") throw new Error("Invalid pending transaction");
      pending.set(account, value);
    }
  } catch { throw new Error("Cannot read the pending NEAR transaction. Restore browser storage before signing again."); }
  return pending.get(account) ?? null;
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
