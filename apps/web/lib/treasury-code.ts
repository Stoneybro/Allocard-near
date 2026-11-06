import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { utils } from "near-api-js";
export async function treasuryWasm() {
  return readFile(/*turbopackIgnore: true*/ process.env.TREASURY_WASM_PATH || resolve(process.cwd(), "../../packages/contracts/res/allocard_treasury.wasm"));
}
export async function treasuryCodeHash() {
  return utils.serialize.base_encode(createHash("sha256").update(await treasuryWasm()).digest());
}
export async function sharedTreasuryWasm() {
  return readFile(/*turbopackIgnore: true*/ process.env.SHARED_TREASURY_WASM_PATH || resolve(process.cwd(), "../../packages/contracts/res/allocard_shared.wasm"));
}
export async function sharedTreasuryCodeHash() {
  return utils.serialize.base_encode(createHash("sha256").update(await sharedTreasuryWasm()).digest());
}
