import { expect, it } from 'vitest';
import { KeyPair } from 'near-api-js';
// @ts-expect-error Operator-only JS tooling is not part of browser declarations.
import { sharedDeploymentActions } from '../scripts/deploy-shared.mjs';
it('initializes one ordinary shared deployment and removes all access keys',()=>{
  const key=KeyPair.fromRandom('ed25519').getPublicKey().toString();
  const batch=sharedDeploymentActions(new Uint8Array([1,2]),'near:testnet',[{public_key:key}]);
  expect(batch).toHaveLength(3);
  expect(batch[0].deployContract.code).toEqual(new Uint8Array([1,2]));
  expect(JSON.parse(new TextDecoder().decode(batch[1].functionCall.args))).toEqual({network_domain:'near:testnet'});
  expect(batch[2].deleteKey.publicKey.toString()).toBe(key);
  expect(batch.some((a:{deployGlobalContract?:unknown})=>a.deployGlobalContract)).toBe(false);
});

// @ts-expect-error Operator-only JS tooling is not part of browser declarations.
import { deployShared, readSharedDeployment, safeDeploymentError } from '../scripts/deploy-shared.mjs';
import { baseEncode, KeyPairSigner } from 'near-api-js';
import { createHash } from 'node:crypto';
import { vi } from 'vitest';

const code=new Uint8Array([1,2]);
const hash=baseEncode(createHash('sha256').update(code).digest());
function fixture() {
  const key=KeyPair.fromRandom('ed25519');
  const provider={
    viewAccount:vi.fn(async()=>({code_hash:'1'.repeat(32),amount:'15000000000000000000000000',storage_usage:200})),
    viewAccessKeyList:vi.fn(async()=>({keys:[{public_key:key.getPublicKey().toString(),access_key:{permission:'FullAccess'}}]})),
    callFunction:vi.fn(async()=>({schema_version:3,network_domain:'near:testnet'})),
  };
  return {provider,key};
}
it('checks the raw RPC account shape without confusing it with Account.getState',async()=>{
  const {provider}=fixture();
  const status=await readSharedDeployment(provider,'allocardpublisher.testnet',hash);
  expect(status.empty).toBe(true);
  expect(status.verified).toBe(false);
  expect(provider.viewAccount).toHaveBeenCalledWith({accountId:'allocardpublisher.testnet',blockQuery:{finality:'final'}});
});
it('deploys an empty account, then verifies code, initialization, and key removal',async()=>{
  const {provider,key}=fixture();
  provider.viewAccount.mockResolvedValueOnce({code_hash:'1'.repeat(32),amount:'15000000000000000000000000',storage_usage:200}).mockResolvedValueOnce({code_hash:hash,amount:'15000000000000000000000000',storage_usage:1000});
  provider.viewAccessKeyList.mockResolvedValueOnce({keys:[{public_key:key.getPublicKey().toString(),access_key:{permission:'FullAccess'}}]}).mockResolvedValueOnce({keys:[]});
  const signAndSendTransaction=vi.fn(async()=>({transaction:{hash:'tx-reference'}}));
  const result=await deployShared({provider,id:'allocardpublisher.testnet',code,key:key.toString(),log:vi.fn(),accountFactory:()=>({getSigner:()=>KeyPairSigner.fromSecretKey(key.toString()),signAndSendTransaction})});
  expect(signAndSendTransaction).toHaveBeenCalledTimes(1);
  expect(result).toEqual({alreadyDeployed:false,transactionHash:'tx-reference'});
});
it('recognizes a completed deployment without signing another transaction',async()=>{
  const {provider}=fixture();
  provider.viewAccount.mockResolvedValue({code_hash:hash,amount:'15000000000000000000000000',storage_usage:1000});
  provider.viewAccessKeyList.mockResolvedValue({keys:[]});
  const accountFactory=vi.fn();
  expect(await deployShared({provider,id:'allocardpublisher.testnet',code,log:vi.fn(),accountFactory})).toEqual({alreadyDeployed:true});
  expect(accountFactory).not.toHaveBeenCalled();
});
it('rejects a mismatched signing key before transaction submission',async()=>{
  const {provider}=fixture();
  const signAndSendTransaction=vi.fn();
  await expect(deployShared({provider,id:'allocardpublisher.testnet',code,key:'present',log:vi.fn(),accountFactory:()=>({getSigner:()=>KeyPairSigner.fromSecretKey(KeyPair.fromRandom('ed25519').toString()),signAndSendTransaction})})).rejects.toThrow('preflight');
  expect(signAndSendTransaction).not.toHaveBeenCalled();
});
it('reports the failing phase and redacts keys and RPC credentials',()=>{
  const secret=KeyPair.fromRandom('ed25519').toString();
  const error=new Error('Shared deployment failed during transaction submission.',{cause:new Error(`Failure with ${secret} at https://rpc.example/token-secret`)});
  const message=safeDeploymentError(error,[secret]);
  expect(message).toContain('transaction submission');
  expect(message).not.toContain(secret);
  expect(message).not.toContain('token-secret');
});
