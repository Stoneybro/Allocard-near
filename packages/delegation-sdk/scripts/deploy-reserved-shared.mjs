// Testnet-only v4 rollout to a fresh relayer subaccount. Existing treasuries are never overwritten.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Account, JsonRpcProvider, actions, baseEncode, formatNearAmount } from 'near-api-js';
import { readSharedDeployment, sharedDeploymentActions, safeDeploymentError } from './deploy-shared.mjs';
export async function main(args = process.argv.slice(2)) {
 const parent = process.env.NEAR_RELAYER_ACCOUNT_ID;
 if (!parent?.endsWith('.testnet')) throw new Error('A testnet relayer is required');
 const id = process.env.NEXT_SHARED_TREASURY_ACCOUNT_ID || `treasury-v4.${parent}`;
 if (id !== `treasury-v4.${parent}`) throw new Error('Use the dedicated fresh v4 relayer subaccount');
 const rpc = process.env.NEAR_RPC_URL || process.env.NEXT_PUBLIC_NEAR_RPC_URL || 'https://rpc.testnet.near.org';
 const code = new Uint8Array(await readFile(new URL('../../contracts/res/allocard_shared.wasm', import.meta.url)));
 const hash = baseEncode(createHash('sha256').update(code).digest());
 const storage = BigInt(code.length + 8000) * 10_000_000_000_000_000_000n;
 const tenth = 100_000_000_000_000_000_000_000n;
 const deposit = ((storage + tenth + tenth - 1n) / tenth) * tenth;
 const provider = new JsonRpcProvider({url:rpc});
 const response = await fetch(rpc,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({jsonrpc:'2.0',id:'v4-preflight',method:'query',params:{request_type:'view_account',account_id:id,finality:'final'}})});
 const accountState = await response.json();
 if (accountState.result) {
  const existing = await readSharedDeployment(provider,id,hash);
  if (!existing.verified) throw new Error('The target account already exists and is not this verified release');
  console.log(JSON.stringify({accountId:id,alreadyDeployed:true,verified:true}));return;
 }
 if (accountState.error?.cause?.name !== 'UNKNOWN_ACCOUNT') throw new Error('Could not establish whether the deployment account exists');
 const parentState = await provider.viewAccount({accountId:parent,blockQuery:{finality:'final'}});
 const available = BigInt(parentState.amount) - BigInt(parentState.storage_usage)*10_000_000_000_000_000_000n;
 console.log(JSON.stringify({network:'testnet',accountId:id,codeHash:hash,bytes:code.length,fundingNear:formatNearAmount(deposit),relayerAvailableNear:formatNearAmount(available),keyless:true,execute:args.includes('--execute')}));
 if (!args.includes('--execute')) return;
 if (available < deposit + tenth) throw new Error('Insufficient relayer funds for deployment and gas');
 if (!process.env.NEAR_RELAYER_PRIVATE_KEY) throw new Error('Relayer signing key required');
 const parentAccount = new Account(parent,provider,process.env.NEAR_RELAYER_PRIVATE_KEY);
 const publicKey = await parentAccount.getSigner().getPublicKey();
 const result = await parentAccount.signAndSendTransaction({receiverId:id,actions:[actions.createAccount(),actions.transfer(deposit),actions.addFullAccessKey(publicKey),...sharedDeploymentActions(code,'near:testnet',[{public_key:publicKey.toString()}])],waitUntil:'FINAL',throwOnFailure:true});
 const verified = await readSharedDeployment(provider,id,hash);
 if (!verified.verified) throw new Error('Verify the deployment before retrying an uncertain transaction');
 console.log(JSON.stringify({accountId:id,verified:true,transactionHash:result.transaction?.hash}));
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(error=>{console.error(safeDeploymentError(error,[process.env.NEAR_RELAYER_PRIVATE_KEY,process.env.NEAR_RPC_URL]));process.exitCode=1});
