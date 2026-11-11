import { expect, it } from "vitest";
import { prepareRootPermission } from "@/lib/root-permission-intent";
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
