import { nearQuery } from "./near-server";
import { sharedTreasuryCodeHash, legacyTreasuryCodeHash } from "./treasury-code";
import { isNativeNearAccount } from "./wallet";
export async function verifiedSharedConfig() {
  const contractId = process.env.SHARED_TREASURY_ACCOUNT_ID;
  if (!contractId || !isNativeNearAccount(contractId) || !contractId.endsWith(".testnet")) throw new Error("Configure SHARED_TREASURY_ACCOUNT_ID");
  const [account, keys, result, expectedHash] = await Promise.all([
    nearQuery({ request_type: "view_account", account_id: contractId }),
    nearQuery({ request_type: "view_access_key_list", account_id: contractId }),
    nearQuery({ request_type: "call_function", account_id: contractId, method_name: "get_platform_config", args_base64: "e30=" }),
    sharedTreasuryCodeHash(),
  ]);
  const config = JSON.parse(Buffer.from(result.result).toString("utf8"));
  const releaseHash = config.schema_version === 3 ? await legacyTreasuryCodeHash(true) : expectedHash;
  if (account.code_hash !== releaseHash || account.global_contract_hash || account.global_contract_account_id || keys.keys.length) throw new Error("Shared contract must match this release and retain no keys");
  if (![3, 4].includes(config.schema_version) || config.network_domain !== "near:testnet" || !/^[1-9][0-9]*$/.test(config.creation_deposit)) throw new Error("Unsupported shared contract configuration");
  return { contractId, ...config };
}
