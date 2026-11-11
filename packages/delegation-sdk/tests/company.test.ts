import { describe, expect, it, vi } from "vitest";
import { AllocardTreasuryClient, computeCompanyId, parseTreasuryReference, treasuryReference } from "../src/index.js";
const a=computeCompanyId('owner.testnet','company-1');
const b=computeCompanyId('owner.testnet','company-2');
describe('company-scoped SDK calls',()=>{
  it('scopes treasury reservations and bounded spending snapshots to the company',async()=>{
    const viewFunction=vi.fn(async()=>({}));
    const client=new AllocardTreasuryClient({contractId:treasuryReference('shared.testnet',a),networkDomain:'near:testnet',caller:{viewFunction}});
    const asset={type:'NativeNear' as const};
    await client.getTreasuryBudget(asset);
    expect(viewFunction).toHaveBeenLastCalledWith({contractId:'shared.testnet',methodName:'get_treasury_budget',args:{company_id:a,asset}});
    await client.getSpendingSnapshots([{permission_id:'1',actor:'employee.testnet'}],asset);
    expect(viewFunction).toHaveBeenLastCalledWith({contractId:'shared.testnet',methodName:'get_spending_snapshots',args:{company_id:a,asset,queries:[{permission_id:'1',actor:'employee.testnet'}]}});
    await expect(client.getSpendingSnapshots(Array.from({length:9},()=>({permission_id:'1',actor:'employee.testnet'})),asset)).rejects.toThrow('At most 8');
  });
  it('isolates calls made to the same contract',async()=>{
    const viewFunction=vi.fn(async()=>({}));
    const functionCall=vi.fn(async()=> '1');
    const client=new AllocardTreasuryClient({contractId:treasuryReference('shared.testnet',a),networkDomain:'near:testnet',caller:{viewFunction,functionCall}});
    await client.getPermission('1');
    expect(viewFunction).toHaveBeenCalledWith({contractId:'shared.testnet',methodName:'get_permission',args:{company_id:a,permission_id:'1'}});
    await client.depositNative('100');
    expect(functionCall).toHaveBeenCalledWith(expect.objectContaining({contractId:'shared.testnet',methodName:'deposit_native',args:{company_id:a},attachedDeposit:'100'}));
  });
  it('binds canonical requests to their company even when IDs and actors match',()=>{
    const options={networkDomain:'near:testnet',caller:{viewFunction:async()=>({})}};
    const first=new AllocardTreasuryClient({...options,contractId:treasuryReference('shared.testnet',a)});
    const second=new AllocardTreasuryClient({...options,contractId:treasuryReference('shared.testnet',b)});
    const request={api_version:1,request_id:'a'.repeat(64),permission_id:'1',deadline_ms:'10000',action:{type:'Transfer' as const,asset:{type:'NativeNear' as const},receiver:'vendor.testnet',amount:'100'}};
    expect(first.getExecuteHash('employee.testnet',request)).not.toBe(second.getExecuteHash('employee.testnet',request));
  });
  it('derives different company identities for different owners with the same key',()=>{
    expect(a).not.toBe(computeCompanyId('other.testnet','company-1'));
    expect(parseTreasuryReference(treasuryReference('shared.testnet',a))).toEqual({contractId:'shared.testnet',companyId:a});
    expect(()=>parseTreasuryReference('shared.testnet#bad')).toThrow();
  });
});
