import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { Account, JsonRpcProvider, actions, baseEncode, formatNearAmount } from "near-api-js";
import { safeDeploymentError } from "./deploy-shared.mjs";

const relayer = process.env.NEAR_RELAYER_ACCOUNT_ID;
const createWithRelayer = process.argv.includes("--create-with-relayer");
const accountId = process.env.MOCK_USDC_ACCOUNT_ID || (createWithRelayer && relayer ? `usdc.${relayer}` : undefined);
const storageBytePrice = 10_000_000_000_000_000_000n;
const deployKey = process.env.MOCK_USDC_DEPLOY_KEY;
const rpcUrl = process.env.NEAR_RPC_URL || "https://rpc.testnet.near.org";
const execute = process.argv.includes("--execute");
const check = process.argv.includes("--check");
const namedTestnetAccount = /^[a-z0-9]+(?:[-_.][a-z0-9]+)*\.testnet$/;

async function main() {
  if (process.env.NEAR_NETWORK && process.env.NEAR_NETWORK !== "testnet") {
    throw new Error("Mock USDC deployment is testnet only");
  }
  const code = new Uint8Array(await readFile(new URL("../../contracts/target/wasm32-unknown-unknown/release/allocard_mock_usdc.wasm", import.meta.url)));
  const creationDeposit = BigInt(code.length) * storageBytePrice + 300_000_000_000_000_000_000_000n;
  const codeHash = baseEncode(createHash("sha256").update(code).digest());
  console.log(JSON.stringify({ network: "testnet", accountId, minter: relayer, codeHash, bytes: code.length, createWithRelayer, creationDepositNear: createWithRelayer ? formatNearAmount(creationDeposit) : undefined, execute }, null, 2));
  if (!execute && !check) return;
  if (!accountId || !relayer || accountId.length > 64 || relayer.length > 64 || !namedTestnetAccount.test(accountId) || !namedTestnetAccount.test(relayer) || accountId === relayer) {
    throw new Error("Set distinct named testnet accounts for MOCK_USDC_ACCOUNT_ID and NEAR_RELAYER_ACCOUNT_ID");
  }
  const rpc = async (method, params) => {
    const response = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: "mock-usdc", method, params }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`NEAR RPC returned HTTP ${response.status}`);
    return response.json();
  };
  const status = await rpc("status", []);
  if (status.result?.chain_id !== "testnet") throw new Error("RPC must report NEAR testnet");

  const provider = new JsonRpcProvider({ url: rpcUrl });
  const view = method => provider.callFunction({ contractId: accountId, method, args: {}, blockQuery: { finality: "final" } });
  const verify = async () => {
    const [state, metadata, minter] = await Promise.all([
      provider.viewAccount({ accountId, blockQuery: { finality: "final" } }),
      view("ft_metadata"),
      view("get_minter"),
    ]);
    if (state.code_hash !== codeHash || metadata.symbol !== "USDC" || metadata.decimals !== 6 || minter !== relayer) {
      throw new Error("The deployed token does not match the local artifact and configured minter");
    }
    console.log("Verified mock USDC deployment:", accountId);
  };
  const accountQuery = await rpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
  const state = accountQuery.result;
  const missing = accountQuery.error?.cause?.name === "UNKNOWN_ACCOUNT";
  if (check || state?.code_hash === codeHash) return verify();
  if (!state && !missing) throw new Error("Could not verify the token account");
  if (state && (state.code_hash !== "1".repeat(32) || state.global_contract_hash || state.global_contract_account_id)) {
    throw new Error("The token account already has deployed code");
  }
  let account;
  const setup = [];
  if (missing) {
    if (!createWithRelayer || !accountId.endsWith(`.${relayer}`) || accountId.slice(0, -(relayer.length + 1)).includes(".")) {
      throw new Error("The token account must exist or be a direct subaccount of the relayer");
    }
    const relayerKey = process.env.NEAR_RELAYER_PRIVATE_KEY;
    if (!relayerKey) throw new Error("Set the relayer signing key in the deployment terminal");
    const parent = await provider.viewAccount({ accountId: relayer, blockQuery: { finality: "final" } });
    const spendable = BigInt(parent.amount) - BigInt(parent.storage_usage) * storageBytePrice;
    const required = creationDeposit + 20_000_000_000_000_000_000_000n;
    if (spendable < required) {
      const available = spendable > 0n ? spendable : 0n;
      throw new Error(`The relayer has ${formatNearAmount(available, 4)} spendable test NEAR and needs ${formatNearAmount(required, 5)} for deployment including gas`);
    }
    account = new Account(relayer, provider, relayerKey);
    const publicKey = await account.getSigner().getPublicKey();
    setup.push(actions.createAccount(), actions.transfer(creationDeposit), actions.addFullAccessKey(publicKey));
  } else {
    if (!deployKey) throw new Error("Set MOCK_USDC_DEPLOY_KEY in the terminal to deploy to the funded token account");
    account = new Account(accountId, provider, deployKey);
  }
  const result = await account.signAndSendTransaction({
    receiverId: accountId,
    actions: [
      ...setup,
      actions.deployContract(code),
      actions.functionCall("new", { minter: relayer }, 50_000_000_000_000n, 0n),
    ],
    waitUntil: "FINAL",
    throwOnFailure: true,
  });
  console.log("Deployment transaction:", result.transaction?.hash);
  await verify();
  console.log("Set NEXT_PUBLIC_MOCK_USDC_ACCOUNT_ID to the verified contract and rebuild the app.");
}

main().catch(error => {
  console.error(safeDeploymentError(error, [deployKey, process.env.NEAR_RELAYER_PRIVATE_KEY, rpcUrl]));
  process.exitCode = 1;
});
