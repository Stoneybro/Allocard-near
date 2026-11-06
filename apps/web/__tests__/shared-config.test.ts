import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const state=vi.hoisted(()=>({account:{} as Record<string,unknown>,keys:[] as unknown[],config:{} as Record<string,unknown>}));
vi.mock('@/lib/treasury-code',()=>({sharedTreasuryCodeHash:async()=> 'shared-code'}));
vi.mock('@/lib/near-server',()=>({nearQuery:async({request_type}:{request_type:string})=>request_type==='view_account'?state.account:request_type==='view_access_key_list'?{keys:state.keys}:{result:[...Buffer.from(JSON.stringify(state.config))]}}));
import { verifiedSharedConfig } from '@/lib/shared-server';
beforeEach(()=>{
 vi.stubEnv('SHARED_TREASURY_ACCOUNT_ID','shared.testnet');
 state.account={code_hash:'shared-code'};state.keys=[];
 state.config={schema_version:3,network_domain:'near:testnet',creation_deposit:'200000000000000000000000'};
});
afterEach(()=>vi.unstubAllEnvs());
describe('verified shared treasury configuration',()=>{
 it('returns a verified quote',async()=>expect(await verifiedSharedConfig()).toMatchObject({contractId:'shared.testnet',schema_version:3}));
 it('rejects mutable or retained deployment authority',async()=>{
  state.keys=[{}];await expect(verifiedSharedConfig()).rejects.toThrow('retain no keys');
  state.keys=[];state.account.global_contract_account_id='publisher.testnet';await expect(verifiedSharedConfig()).rejects.toThrow('retain no keys');
 });
 it('rejects code and network mismatches',async()=>{
  state.account.code_hash='other';await expect(verifiedSharedConfig()).rejects.toThrow('match this release');
  state.account.code_hash='shared-code';state.config.network_domain='near:mainnet';await expect(verifiedSharedConfig()).rejects.toThrow('Unsupported');
 });
});
