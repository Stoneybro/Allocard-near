import type { PermissionSpec } from "@allocard/delegation-sdk";
import { RetryableNearTransactionError } from "./near-transaction-error";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export type RootPermissionIntent = { terms: string; spec: PermissionSpec; permissionId: string | null; attempted?: boolean };
export function assertRootPermissionRetrySafe(intent: RootPermissionIntent, hasPendingTransaction: boolean) {
  if (!intent.permissionId && intent.attempted && !hasPendingTransaction) throw new Error("The earlier signing attempt has no recoverable transaction result. Check its transaction in the explorer before creating another allowance; it may already have reserved funds.");
}
export function releaseUnsubmittedRootPermission(storage: Storage, key: string, error: unknown) {
  if (!(error instanceof RetryableNearTransactionError)) return false;
  const raw = storage.getItem(key);
  if (!raw || JSON.parse(raw).permissionId) return false;
  storage.removeItem(key);
  return true;
}
export function matchingRootTerms(left: string, right: string) {
  const normalize = (value: string) => {
    const terms = JSON.parse(value);
    if (terms?.caveats && !terms.caveats.expiresAt) delete terms.caveats.expiresAt;
    return JSON.stringify(terms);
  };
  try { return normalize(left) === normalize(right); } catch { return left === right; }
}
/** Preserve the exact signed intent across timeouts and a failed database synchronization. */
export function prepareRootPermission(storage: Storage, key: string, terms: string, spec: PermissionSpec): RootPermissionIntent {
  const raw = storage.getItem(key);
  if (raw) {
    const saved = JSON.parse(raw) as RootPermissionIntent;
    if (!matchingRootTerms(saved.terms, terms)) throw new Error("The previous allowance is still being confirmed. Restore its rules and retry to recover it before changing the amount or policy.");
    if (!saved.spec || !(saved.permissionId === null || /^\d+$/.test(saved.permissionId))) throw new Error("Saved allowance needs reconciliation before signing another permission.");
    return saved;
  }
  const intent = { terms, spec, permissionId: null };
  storage.setItem(key, JSON.stringify(intent)); // Refuse to sign if recovery state cannot be saved.
  return intent;
}
