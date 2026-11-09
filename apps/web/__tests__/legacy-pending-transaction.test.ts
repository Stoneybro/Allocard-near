import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks=vi.hoisted(()=>({adapter:vi.fn(),rpc:vi.fn()}));
vi.mock("@/lib/near-sponsor-client",()=>({sponsoredCreateAdapter:mocks.adapter,sponsoredCreateCompany:vi.fn(),sponsoredExecute:vi.fn()}));
vi.mock("@/lib/near-rpc-client",()=>({nearBrowserRpc:mocks.rpc}));
import { clearPendingNearTransaction, readPendingNearTransaction, savePendingNearTransaction } from "@/lib/near-pending-transaction";
import { createPrivyNearTransport } from "@/lib/privy-near";
const account="ac".repeat(32),other="bd".repeat(32);
const rejected="9JCCqcCg424GdThZjuR8Waw8RMkRwypxCxFuh172RsB7";
const storage=new Map<string,string>();
const record=(hash=rejected,methodName="create_child_permission")=>({hash,requestKey:JSON.stringify({methodName})});
const permission={treasury:"treasury.testnet",delegationId:"11111111-1111-4111-8111-111111111111",parentId:"7",spec:{delegate:"adapter.testnet",valid_from_ms:"0",redelegation_depth:0,rules:[{asset:{type:"NativeNear" as const},recipients:{type:"Any" as const},lifetime_limit:"10",acknowledge_unbounded_budget:false}]}};
beforeEach(()=>{
 vi.clearAllMocks();storage.clear();
 vi.stubGlobal("localStorage",{getItem:(key:string)=>storage.get(key)??null,setItem:(key:string,value:string)=>storage.set(key,value),removeItem:(key:string)=>storage.delete(key)});
 vi.stubEnv("NEXT_PUBLIC_NEAR_REJECTED_LEGACY_TX_HASHES",rejected);
});
afterEach(()=>{clearPendingNearTransaction(account);clearPendingNearTransaction(other);vi.unstubAllGlobals();vi.unstubAllEnvs();});
describe("reviewed legacy NEAR validation rejection migration",()=>{
 it("removes the historical rejected adapter record when retrying through a new transport",async()=>{
  savePendingNearTransaction(account,record());
  mocks.adapter.mockResolvedValue({adapterPermissionId:"9"});const sign=vi.fn();
  expect(await createPrivyNearTransport(account,sign).createAdapterPermission(permission)).toEqual({adapterPermissionId:"9"});
  expect(mocks.adapter).toHaveBeenCalledWith(account,permission,sign);
  expect(readPendingNearTransaction(account)).toBeNull();expect(storage.size).toBe(0);expect(mocks.rpc).not.toHaveBeenCalled();
 });
 it("keeps an unrelated unknown adapter transaction blocked",async()=>{
  const pending=record("2".repeat(44));savePendingNearTransaction(account,pending);
  await expect(createPrivyNearTransport(account,vi.fn()).createAdapterPermission(permission)).rejects.toThrow("Resolve wallet-funded transaction");
  expect(readPendingNearTransaction(account)).toEqual(pending);expect(mocks.adapter).not.toHaveBeenCalled();
 });
 it("never applies this adapter migration to an unresolved payment",async()=>{
  const pending=record(rejected,"execute");savePendingNearTransaction(account,pending);
  await expect(createPrivyNearTransport(account,vi.fn()).createAdapterPermission(permission)).rejects.toThrow("Resolve wallet-funded transaction");
  expect(readPendingNearTransaction(account)).toEqual(pending);expect(mocks.adapter).not.toHaveBeenCalled();
 });
 it("leaves the legacy record alone when no rejection was explicitly reviewed",()=>{
  vi.stubEnv("NEXT_PUBLIC_NEAR_REJECTED_LEGACY_TX_HASHES","");const pending=record();savePendingNearTransaction(account,pending);
  expect(readPendingNearTransaction(account)).toEqual(pending);
 });
 it("does not remove another account's unresolved transaction",()=>{
  savePendingNearTransaction(account,record());const unknown=record("3".repeat(44));savePendingNearTransaction(other,unknown);
  expect(readPendingNearTransaction(account)).toBeNull();expect(readPendingNearTransaction(other)).toEqual(unknown);
 });
 it("does not resurrect a record removed from storage by another tab",()=>{
  const unknown=record("4".repeat(44));savePendingNearTransaction(account,unknown);expect(readPendingNearTransaction(account)).toEqual(unknown);
  storage.clear();expect(readPendingNearTransaction(account)).toBeNull();
 });
});
