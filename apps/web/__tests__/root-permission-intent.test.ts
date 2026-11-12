import { expect, it } from "vitest";
import { prepareRootPermission, releaseUnsubmittedRootPermission, assertRootPermissionRetrySafe } from "@/lib/root-permission-intent";
import { RetryableNearTransactionError } from "@/lib/near-transaction-error";
import type { PermissionSpec } from "@allocard/delegation-sdk";
it("recovers the same signed terms and permission instead of allocating twice after a timeout", () => {
  const rows=new Map<string,string>();
  const storage={getItem:(key:string)=>rows.get(key)??null,setItem:(key:string,value:string)=>{rows.set(key,value);},removeItem:(key:string)=>{rows.delete(key);}};
  const spec={delegate:"employee.testnet",valid_from_ms:"1000"} as PermissionSpec;
  const first=prepareRootPermission(storage,"company:employee","500 USDC",spec);
  expect(prepareRootPermission(storage,"company:employee","500 USDC",{...spec,valid_from_ms:"2000"}).spec.valid_from_ms).toBe("1000");
  storage.setItem("company:employee",JSON.stringify({...first,permissionId:"7"}));
  expect(prepareRootPermission(storage,"company:employee","500 USDC",spec).permissionId).toBe("7");
  expect(()=>prepareRootPermission(storage,"company:employee","600 USDC",spec)).toThrow("previous allowance");
});
it("releases cancelled or rejected attempts but preserves uncertain and confirmed grants", () => {
  const rows = new Map<string, string>();
  const storage = { getItem: (key: string) => rows.get(key) ?? null, setItem: (key: string, value: string) => { rows.set(key, value); }, removeItem: (key: string) => { rows.delete(key); } };
  const spec = { delegate: "employee.testnet", valid_from_ms: "1000" } as PermissionSpec;
  const intent = prepareRootPermission(storage, "key", "original", spec);
  expect(releaseUnsubmittedRootPermission(storage, "key", new Error("timeout"))).toBe(false);
  expect(() => prepareRootPermission(storage, "key", "changed", spec)).toThrow();
  expect(releaseUnsubmittedRootPermission(storage, "key", new RetryableNearTransactionError("User cancelled"))).toBe(true);
  expect(prepareRootPermission(storage, "key", "changed", spec).terms).toBe("changed");
  storage.setItem("key", JSON.stringify({ ...intent, permissionId: "7" }));
  expect(releaseUnsubmittedRootPermission(storage, "key", new RetryableNearTransactionError("rejected"))).toBe(false);
});
it("does not sign a duplicate grant if a successful response lost its permission ID", () => {
  const intent = { terms: "rules", spec: {} as PermissionSpec, permissionId: null, attempted: true };
  expect(() => assertRootPermissionRetrySafe(intent, false)).toThrow("may already have reserved funds");
  expect(() => assertRootPermissionRetrySafe(intent, true)).not.toThrow();
  expect(() => assertRootPermissionRetrySafe({ ...intent, sponsored: true }, false)).not.toThrow();
  expect(() => assertRootPermissionRetrySafe({ ...intent, permissionId: "7" }, false)).not.toThrow();
});
