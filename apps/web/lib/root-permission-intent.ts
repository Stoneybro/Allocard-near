import type { PermissionSpec } from "@allocard/delegation-sdk";

type Storage = Pick<globalThis.Storage, "getItem" | "setItem" | "removeItem">;
export type RootPermissionIntent = { terms: string; spec: PermissionSpec; permissionId: string | null };
/** Preserve the exact signed intent across timeouts and a failed database synchronization. */
export function prepareRootPermission(storage: Storage, key: string, terms: string, spec: PermissionSpec): RootPermissionIntent {
  const raw = storage.getItem(key);
  if (raw) {
    const saved = JSON.parse(raw) as RootPermissionIntent;
    if (saved.terms !== terms) throw new Error("The previous allowance is still being confirmed. Restore its rules and retry to recover it before changing the amount or policy.");
    if (!saved.spec || !(saved.permissionId === null || /^\d+$/.test(saved.permissionId))) throw new Error("Saved allowance needs reconciliation before signing another permission.");
    return saved;
  }
  const intent = { terms, spec, permissionId: null };
  storage.setItem(key, JSON.stringify(intent)); // Refuse to sign if recovery state cannot be saved.
  return intent;
}
