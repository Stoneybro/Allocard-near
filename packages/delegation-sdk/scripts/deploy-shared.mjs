// Operator tooling only: a single ordinary deployment, no global publication.
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { Account, JsonRpcProvider, PublicKey, actions, baseEncode, formatNearAmount } from 'near-api-js';
const EMPTY_CODE_HASH = '1'.repeat(32);
export function sharedDeploymentActions(code, networkDomain, keys) {
  if (!keys.length) throw new Error('An initial deployment key is required');
  return [actions.deployContract(code), actions.functionCall('new', { network_domain: networkDomain }, 50_000_000_000_000n, 0n), ...keys.map(key => actions.deleteKey(PublicKey.fromString(key.public_key)))];
}
export async function readSharedDeployment(provider, id, expectedHash) {
  // Provider.viewAccount returns raw RPC fields. Account.getState instead uses
  // codeHash/storageUsage and omits global references; do not mix the two shapes.
  const [state, keys] = await Promise.all([
    provider.viewAccount({ accountId: id, blockQuery: { finality: 'final' } }),
    provider.viewAccessKeyList({ accountId: id, finalityQuery: { finality: 'final' } }),
  ]);
  const matches = state.code_hash === expectedHash && !state.global_contract_hash && !state.global_contract_account_id;
  let verified = false;
  if (matches && keys.keys.length === 0) {
    const config = await provider.callFunction({ contractId: id, method: 'get_platform_config', args: {}, blockQuery: { finality: 'final' } });
    verified = config.schema_version === 5 && config.network_domain === 'near:testnet';
  }
  return { state, keys: keys.keys, verified, empty: state.code_hash === EMPTY_CODE_HASH && !state.global_contract_hash && !state.global_contract_account_id };
}
export async function deployShared({ provider, id, code, key, log = console.log, accountFactory = (id, provider, key) => new Account(id, provider, key) }) {
  let phase = 'preflight account check';
  try {
    const hash = baseEncode(createHash('sha256').update(code).digest());
    const before = await readSharedDeployment(provider, id, hash);
    if (before.verified) { log('Shared treasury is already deployed and verified. No transaction submitted.'); return { alreadyDeployed: true }; }
    if (!before.empty) throw new Error('The account already contains code. Do not overwrite it; inspect the deployed release.');
    if (!key) throw new Error('SHARED_TREASURY_DEPLOY_KEY is missing from this terminal.');
    const account = accountFactory(id, provider, key);
    const publicKey = (await account.getSigner().getPublicKey()).toString();
    if (!before.keys.some(item => item.public_key === publicKey && item.access_key?.permission === 'FullAccess')) throw new Error('The deployment key does not match a full-access key on this account.');
    phase = 'transaction submission';
    log('Preflight passed. Submitting deployment, initialization, and key removal.');
    const result = await account.signAndSendTransaction({ receiverId: id, actions: sharedDeploymentActions(code, 'near:testnet', before.keys), waitUntil: 'FINAL', throwOnFailure: true });
    log('Deployment transaction:', result.transaction?.hash || result.transaction_outcome?.id || '(check account state)');
    phase = 'post-deployment verification';
    const after = await readSharedDeployment(provider, id, hash);
    if (!after.verified) throw new Error('Deployment outcome could not be verified. Run shared:deploy --check before retrying.');
    log('Verified shared treasury:', id);
    return { alreadyDeployed: false, transactionHash: result.transaction?.hash };
  } catch (cause) { throw new Error(`Shared deployment failed during ${phase}.`, { cause }); }
}
export function safeDeploymentError(error, secrets = []) {
  const messages = [];
  for (let current = error, depth = 0; current && depth < 4; current = current.cause, depth++) {
    if (typeof current.message === 'string') messages.push(current.message);
    if (typeof current.type === 'string' && /^[a-zA-Z0-9_]{1,80}$/.test(current.type)) messages.push(`NEAR error type: ${current.type}`);
  }
  let text = messages.join('\n');
  for (const secret of secrets.filter(Boolean)) text = text.split(secret).join('[REDACTED]');
  return text.replace(/(?:ed25519|secp256k1|ml-dsa-65):[A-Za-z0-9+/=_-]{60,}/g, '[REDACTED KEY]')
    .replace(/https?:\/\/[^\s"']+/g, '[RPC URL]')
    .replace(/[A-Za-z0-9+/=_-]{80,}/g, '[REDACTED PAYLOAD]').slice(0, 1400);
}
export async function main(args = process.argv.slice(2)) {
  if (process.env.NEAR_NETWORK && process.env.NEAR_NETWORK !== 'testnet') throw new Error('This rollout is testnet-only');
  const id = process.env.SHARED_TREASURY_ACCOUNT_ID;
  const code = new Uint8Array(await readFile(new URL('../../contracts/res/allocard_shared.wasm', import.meta.url)));
  const hash = baseEncode(createHash('sha256').update(code).digest());
  console.log(JSON.stringify({ network: 'testnet', contractId: id || '(set SHARED_TREASURY_ACCOUNT_ID)', bytes: code.length, codeHash: hash, execution: args.includes('--execute') }, null, 2));
  if (!args.includes('--execute') && !args.includes('--check')) { console.log('Plan only. One ordinary code storage allocation; no global publication. Execution removes every deployment key and permanently fixes this shared release.'); return; }
  if (!id || id.length > 64 || !/^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/.test(id)) throw new Error('Set SHARED_TREASURY_ACCOUNT_ID to the intended named testnet account.');
  const provider = new JsonRpcProvider({ url: process.env.NEAR_RPC_URL || 'https://rpc.testnet.near.org' });
  if (args.includes('--check')) {
    const status = await readSharedDeployment(provider, id, hash);
    console.log(JSON.stringify({ contractId: id, balanceNear: formatNearAmount(status.state.amount, 4), codeHash: status.state.code_hash, accessKeyCount: status.keys.length, empty: status.empty, verifiedDeployment: status.verified }, null, 2));
    if (!status.empty && !status.verified) process.exitCode = 1;
    return;
  }
  await deployShared({ provider, id, code, key: process.env.SHARED_TREASURY_DEPLOY_KEY });
  console.log('Set SHARED_TREASURY_ACCOUNT_ID on the app server and restart. Keep the deployment key out of the application environment.');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(error => {
  console.error(safeDeploymentError(error, [process.env.SHARED_TREASURY_DEPLOY_KEY, process.env.NEAR_RPC_URL]));
  console.error('Run pnpm shared:deploy --check before retrying an uncertain transaction.');
  process.exitCode = 1;
});
