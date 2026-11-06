// Operator-only tooling. Never import into application or browser code.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Account, JsonRpcProvider, PublicKey, actions, baseEncode } from 'near-api-js';
const artifacts = new URL('../../contracts/res/', import.meta.url);
export function factoryDeploymentActions(code, config, keys) {
  if (!keys.length) throw new Error('Factory account needs a deployment key');
  return [actions.deployContract(code), actions.functionCall('new', config, 50_000_000_000_000n, 0n), ...keys.map(key => actions.deleteKey(PublicKey.fromString(key.public_key)))];
}
export async function main(args = process.argv.slice(2)) {
  if (process.env.NEAR_NETWORK && process.env.NEAR_NETWORK !== 'testnet') throw new Error('This rollout tool is testnet-only');
  const stage = args.find(value => value === 'publish' || value === 'deploy');
  if (!stage) throw new Error('Choose publish or deploy; add --execute only when ready to sign');
  const treasury = new Uint8Array(await readFile(new URL('allocard_treasury.wasm', artifacts)));
  const hash = baseEncode(createHash('sha256').update(treasury).digest());
  const funding = process.env.FACTORY_ACCOUNT_FUNDING || '200000000000000000000000'; // 0.2 NEAR; verify on testnet
  const factoryId = process.env.FACTORY_ACCOUNT_ID;
  console.log(JSON.stringify({ stage, network: 'testnet', treasuryCodeHash: hash, treasuryBytes: treasury.length, factoryId: factoryId || '(set FACTORY_ACCOUNT_ID)', accountFundingYocto: funding, execution: args.includes('--execute') }, null, 2));
  if (!args.includes('--execute')) {
    console.log('Plan only. Publication burns a one-time global code fee. Deployment removes ALL factory access keys atomically; this release cannot then be upgraded.');
    return;
  }
  const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org' });
  if (stage === 'publish') {
    const id = process.env.NEAR_PUBLISHER_ACCOUNT_ID;
    const key = process.env.NEAR_PUBLISHER_KEY;
    if (!id || !id.endsWith('.testnet') || !key) throw new Error('Set funded NEAR_PUBLISHER_ACCOUNT_ID and NEAR_PUBLISHER_KEY');
    const account = new Account(id, provider, key);
    const outcome = await account.signAndSendTransaction({ receiverId: id, actions: [actions.deployGlobalContract(treasury, 'codeHash')], waitUntil: 'FINAL', throwOnFailure: true });
    console.log('Global publication transaction:', outcome.transaction.hash);
    console.log('Pinned global code hash:', hash, 'Wait for global distribution before deploying/provisioning.');
  } else {
    const key = process.env.FACTORY_DEPLOY_KEY;
    if (!factoryId || !factoryId.endsWith('.testnet') || factoryId.length > 29 || !key) throw new Error('Set funded FACTORY_ACCOUNT_ID (max 29 characters) and FACTORY_DEPLOY_KEY');
    if (!/^[1-9][0-9]*$/.test(funding)) throw new Error('Invalid FACTORY_ACCOUNT_FUNDING');
    const account = new Account(factoryId, provider, key);
    const code = new Uint8Array(await readFile(new URL('allocard_factory.wasm', artifacts)));
    // Fail closed on an already-deployed factory; never overwrite unknown code/state.
    const state = await account.getState();
    if (state.code_hash !== '1'.repeat(32) || state.global_contract_hash || state.global_contract_account_id) throw new Error('Use a fresh empty factory account');
    const keys = await account.getAccessKeyList();
    const outcome = await account.signAndSendTransaction({ receiverId: factoryId, actions: factoryDeploymentActions(code, { treasury_code_hash: hash, network_domain: 'near:testnet', account_funding: funding }, keys.keys), waitUntil: 'FINAL', throwOnFailure: true });
    const config = await provider.callFunction({ contractId: factoryId, method: 'get_config', args: {} });
    const finalState = await account.getState();
    const remainingKeys = await account.getAccessKeyList();
    const factoryHash = baseEncode(createHash('sha256').update(code).digest());
    if (remainingKeys.keys.length || finalState.code_hash !== factoryHash || config.treasury_code_hash !== hash || config.network_domain !== 'near:testnet') throw new Error('Factory post-deployment verification failed');
    console.log('Verified keyless factory:', factoryId, 'transaction:', outcome.transaction.hash);
    console.log('Set server-only TREASURY_FACTORY_ACCOUNT_ID to this account, then restart the web app.');
  }
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(error => {
  // Never print signed payloads, environment values, or SDK errors that may contain keys.
  console.error('Factory rollout failed. Check account funding, global code distribution, and transaction outcomes before retrying.');
  process.exitCode = 1;
});
