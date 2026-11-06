import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { utils } from "near-api-js";
import { nearQuery } from "./near-server";
import { treasuryCodeHash } from "./treasury-code";
import { isNativeNearAccount } from "./wallet";
export async function verifiedFactoryConfig() {
  const factoryId = process.env.TREASURY_FACTORY_ACCOUNT_ID;
  if (!factoryId || !isNativeNearAccount(factoryId) || !factoryId.endsWith(".testnet")) throw new Error("Configure a testnet treasury factory");
  const code = await readFile(/*turbopackIgnore: true*/ process.env.FACTORY_WASM_PATH || resolve(process.cwd(), "../../packages/contracts/res/allocard_factory.wasm"));
  const factoryHash = utils.serialize.base_encode(createHash("sha256").update(code).digest());
  const [account, keys, result, treasuryHash] = await Promise.all([
    nearQuery({ request_type: "view_account", account_id: factoryId }),
    nearQuery({ request_type: "view_access_key_list", account_id: factoryId }),
    nearQuery({ request_type: "call_function", account_id: factoryId, method_name: "get_config", args_base64: "e30=" }),
    treasuryCodeHash(),
  ]);
  const config = JSON.parse(Buffer.from(result.result).toString("utf8"));
  if (account.code_hash !== factoryHash || account.global_contract_hash || account.global_contract_account_id || keys.keys.length !== 0) throw new Error("Factory must match this release and have no retained access keys");
  if (config.schema_version !== 1 || config.network_domain !== "near:testnet" || config.treasury_code_hash !== treasuryHash) throw new Error("Factory global code does not match this release");
  if (!/^[1-9][0-9]*$/.test(config.account_funding) || !/^[1-9][0-9]*$/.test(config.record_funding) || BigInt(config.creation_deposit) !== BigInt(config.account_funding) + BigInt(config.record_funding)) throw new Error("Invalid factory quote");
  return { factoryId, ...config };
}
