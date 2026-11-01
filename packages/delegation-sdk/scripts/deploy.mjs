// Deployment-only tooling. Never import into the application server or browser.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { Account, JsonRpcProvider, actions, baseEncode } from 'near-api-js';

export function deploymentActions(code, config) {
  return [actions.deployContract(code), actions.functionCall('new', { config }, 100_000_000_000_000n, 0n)];
}

export async function deploy() {
  const { TREASURY_ACCOUNT_ID, OWNER_ACCOUNT_ID, TREASURY_DEPLOY_KEY, WASM_PATH } = process.env;
  const network = process.env.NEAR_NETWORK || 'testnet';
  if (!['testnet', 'mainnet'].includes(network)) throw new Error('Unsupported NEAR_NETWORK');
  if (!TREASURY_ACCOUNT_ID || !OWNER_ACCOUNT_ID || !TREASURY_DEPLOY_KEY || !WASM_PATH) {
    throw new Error('Set TREASURY_ACCOUNT_ID, OWNER_ACCOUNT_ID, TREASURY_DEPLOY_KEY and WASM_PATH');
  }
  const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || `https://rpc.${network}.near.org` });
  const account = new Account(TREASURY_ACCOUNT_ID, provider, TREASURY_DEPLOY_KEY);
  const code = new Uint8Array(await readFile(WASM_PATH));
  const config = { network_domain: `near:${network}`, owner: OWNER_ACCOUNT_ID };
  // Code deployment and initialization execute in one atomic action batch.
  await account.signAndSendTransaction({ receiverId: TREASURY_ACCOUNT_ID,
    actions: deploymentActions(code, config), waitUntil: 'FINAL', throwOnFailure: true });
  const deployed = await account.getState();
  const expectedHash = baseEncode(createHash('sha256').update(code).digest());
  const actualConfig = await provider.callFunction({ contractId: TREASURY_ACCOUNT_ID, method: 'get_config', args: {} });
  if (deployed.code_hash !== expectedHash || actualConfig?.owner !== OWNER_ACCOUNT_ID || actualConfig?.network_domain !== config.network_domain) {
    throw new Error('Post-deployment code hash / owner / domain verification failed');
  }
  const keys = await account.getAccessKeyList();
  console.log('Verified deployment:', TREASURY_ACCOUNT_ID, expectedHash);
  console.log('Access keys retained:', keys.keys.length, '(development deployment; keys may bypass contract controls)');
  console.log('Fund storage and operating pools separately before creating permissions or paying vendors.');
}
