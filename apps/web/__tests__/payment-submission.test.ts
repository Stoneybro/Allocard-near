import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { sponsoredExecute } from "@/lib/near-sponsor-client";
import { preparePendingPayment } from "@/lib/pending-payment";
const account="a".repeat(64),treasury="shared.testnet",key=`allocard-payment:${treasury}:${account}`;
const request={api_version:1 as const,permission_id:"7",request_id:"b".repeat(64),deadline_ms:String(Date.now()+900000),action:{type:"Transfer" as const,asset:{type:"NativeNear" as const},receiver:"vendor.testnet",amount:"10"}};
let entries:Map<string,string>;
const storage={getItem:(key:string)=>entries.get(key)??null,setItem:(key:string,value:string)=>{entries.set(key,value);},removeItem:(key:string)=>{entries.delete(key);}};
beforeEach(()=>{entries=new Map([[key,JSON.stringify({request,attempted:true,submissionAttempted:false})]]);vi.stubGlobal("localStorage",storage);});
afterEach(()=>vi.unstubAllGlobals());
const signature=async()=>`0x${"00".repeat(64)}` as `0x${string}`;
const prepare=()=>Response.json({enabled:true,nonce:"2",maxBlockHeight:"220"});
const replace=()=>preparePendingPayment({storage,key,companyId:"company",receiver:"new-vendor.testnet",amount:"20",activePermissionId:"7",readExecution:async()=>null});
it("lets a different payment replace one that failed sponsorship preparation",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(Response.json({error:"Payment exceeds permission"},{status:409})));
 await expect(sponsoredExecute(account,treasury,{request},signature)).rejects.toThrow("exceeds permission");
 expect((await replace()).saved.request.action.amount).toBe("20");
});
it("lets a different payment replace a cancelled signature prompt",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValue(prepare()));
 await expect(sponsoredExecute(account,treasury,{request},async()=>{throw Error("User cancelled");})).rejects.toThrow("User cancelled");
 expect((await replace()).saved.request.action.receiver).toBe("new-vendor.testnet");expect(fetch).toHaveBeenCalledTimes(1);
});
it("releases a request explicitly rejected before transaction submission",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(prepare()).mockResolvedValueOnce(Response.json({error:"Invalid transaction",submissionState:"not_submitted"},{status:409})));
 await expect(sponsoredExecute(account,treasury,{request},signature)).rejects.toThrow("Invalid transaction");
 expect(JSON.parse(entries.get(key)!).submissionAttempted).toBe(false);expect((await replace()).saved.request.action.amount).toBe("20");
});
it("retains the original request when a submit response is lost",async()=>{
 vi.stubGlobal("fetch",vi.fn().mockResolvedValueOnce(prepare()).mockRejectedValueOnce(Error("network reset")));
 await expect(sponsoredExecute(account,treasury,{request},signature)).rejects.toThrow("could not be confirmed");
 expect(JSON.parse(entries.get(key)!).submissionAttempted).toBe(true);await expect(replace()).rejects.toThrow("still processing");
});
it("does not submit a signature for a draft replaced while approval was open",async()=>{
 const rpc=vi.fn().mockResolvedValueOnce(prepare());vi.stubGlobal("fetch",rpc);
 await expect(sponsoredExecute(account,treasury,{request},async()=>{entries.delete(key);return signature();})).rejects.toThrow("Payment details changed");
 expect(fetch).toHaveBeenCalledTimes(1);
});
