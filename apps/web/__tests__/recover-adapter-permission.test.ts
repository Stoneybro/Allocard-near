import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/near-rpc-client",()=>({nearBrowserRpc:vi.fn()}));
import { nearBrowserRpc } from "@/lib/near-rpc-client";
import { recoverAdapterPermission } from "@/lib/recover-adapter-permission";
const input={hash:"DSMY6UTeoWCr3L8YVjy7myoR5bnDRhhXvRh68BxPmzcM",wallet:"employee.testnet",treasury:"treasury.testnet",parentId:"1",delegate:"adapter.testnet"};
const outcome=()=>({transaction:{signer_id:input.wallet,receiver_id:input.treasury,actions:[{FunctionCall:{method_name:"create_child_permission",args:Buffer.from(JSON.stringify({parent_id:"1",spec:{delegate:input.delegate}})).toString("base64")}}]},status:{SuccessValue:Buffer.from(JSON.stringify("2")).toString("base64")}});
beforeEach(()=>vi.resetAllMocks());
describe("read-only recovery of an existing adapter transaction",()=>{
 it("recovers the confirmed permission without any broadcast",async()=>{vi.mocked(nearBrowserRpc).mockResolvedValue(outcome());expect(await recoverAdapterPermission(input)).toBe("2");expect(nearBrowserRpc).toHaveBeenCalledTimes(1);expect(nearBrowserRpc).toHaveBeenCalledWith("tx",{tx_hash:input.hash,sender_account_id:input.wallet,wait_until:"FINAL"});});
 it("rejects a different signer",async()=>{const result=outcome();result.transaction.signer_id="other.testnet";vi.mocked(nearBrowserRpc).mockResolvedValue(result);await expect(recoverAdapterPermission(input)).rejects.toThrow("different signer");});
 it("rejects a permission for a different parent",async()=>{vi.mocked(nearBrowserRpc).mockResolvedValue(outcome());await expect(recoverAdapterPermission({...input,parentId:"3"})).rejects.toThrow("different parent");});
 it("rejects an on-chain contract failure",async()=>{vi.mocked(nearBrowserRpc).mockResolvedValue({...outcome(),status:{Failure:{ExecutionError:"Permission expired"}}});await expect(recoverAdapterPermission(input)).rejects.toThrow("Permission expired");});
});
