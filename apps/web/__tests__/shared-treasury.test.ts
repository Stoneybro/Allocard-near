import { afterEach, describe, expect, it, vi } from "vitest";
import { computeCompanyId } from "@allocard/delegation-sdk";
import { registerCompany, type SharedConfig } from "@/lib/shared-treasury";
import { treasuryReader, verifyPaymentTransaction } from "@/lib/near-server";
const id=computeCompanyId('owner.testnet','company-1');
const config={contractId:'shared.testnet',schema_version:5,network_domain:'near:testnet',creation_deposit:'200000000000000000000000'} as SharedConfig;
afterEach(()=>vi.unstubAllGlobals());
function rpc(values: unknown[]) {
  const fetcher=vi.fn(async (_url:unknown,_options:RequestInit)=>Response.json({result:{result:[...Buffer.from(JSON.stringify(values.shift()))]}}));
  vi.stubGlobal('fetch',fetcher);return fetcher;
}
describe('shared company onboarding',()=>{
  it('reconciles existing registration without a second deposit',async()=>{
    rpc([true]);const functionCall=vi.fn();
    const ref=await registerCompany({accountId:'owner.testnet',viewFunction:vi.fn(),functionCall},config,'company-1');
    expect(ref).toBe(`shared.testnet#${id}`);expect(functionCall).not.toHaveBeenCalled();
  });
  it('registers with a normal function call and checks the resulting state',async()=>{
    rpc([false,true]);const functionCall=vi.fn(async()=>({}));
    expect(await registerCompany({accountId:'owner.testnet',viewFunction:vi.fn(),functionCall},config,'company-1')).toBe(`shared.testnet#${id}`);
    expect(functionCall).toHaveBeenCalledWith(expect.objectContaining({contractId:'shared.testnet',methodName:'create_company',args:{company_key:'company-1'},attachedDeposit:config.creation_deposit}));
  });
  it('recovers registration after an uncertain submission',async()=>{
    rpc([false,true]);
    expect(await registerCompany({accountId:'owner.testnet',viewFunction:vi.fn(),functionCall:async()=>{throw new Error('timeout');}},config,'company-1')).toBe(`shared.testnet#${id}`);
  });
  it('sends server reads to the native account with the explicit company scope',async()=>{
    const fetcher=rpc([{schema_version:3}]);await treasuryReader(`shared.testnet#${id}`).getConfig();
    const request=JSON.parse(String(fetcher.mock.calls[0][1].body));
    expect(request.params.account_id).toBe('shared.testnet');
    expect(JSON.parse(Buffer.from(request.params.args_base64,'base64').toString())).toEqual({company_id:id});
  });
});
describe('company binding of payment transactions',()=>{
  it('rejects a payment belonging to another company on the same account',async()=>{
    const hash='A'.repeat(44);const requestId='b'.repeat(64);
    const result={status:{SuccessValue:'IjEi'},transaction:{hash,signer_id:'employee.testnet',receiver_id:'shared.testnet',actions:[{FunctionCall:{method_name:'execute',args:Buffer.from(JSON.stringify({company_id:id,request:{request_id:requestId}})).toString('base64')}}]}};
    vi.stubGlobal('fetch',vi.fn(async()=>Response.json({result})));
    await expect(verifyPaymentTransaction(hash,'employee.testnet',`shared.testnet#${id}`,requestId)).resolves.toBeUndefined();
    await expect(verifyPaymentTransaction(hash,'employee.testnet',`shared.testnet#${'f'.repeat(64)}`,requestId)).rejects.toThrow('does not contain');
    await expect(verifyPaymentTransaction(hash,'employee.testnet','shared.testnet',requestId)).rejects.toThrow('does not contain');
  });
});
