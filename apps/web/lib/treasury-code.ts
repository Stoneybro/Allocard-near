import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { utils } from "near-api-js";
export async function treasuryWasm() {
  return readFile(/*turbopackIgnore: true*/ process.env.TREASURY_WASM_PATH || resolve(process.cwd(), "../../packages/contracts/res/allocard_treasury.wasm"));
}
const hashes = new Map<string, Promise<string>>();
function releaseHash(key: string, read: () => Promise<Buffer>) {
  let value = hashes.get(key);
  if (!value) { value = read().then(wasm => utils.serialize.base_encode(createHash("sha256").update(wasm).digest())).catch(error => { hashes.delete(key); throw error; }); hashes.set(key, value); }
  return value;
}
export async function treasuryCodeHash() {
  return releaseHash(process.env.TREASURY_WASM_PATH || "treasury", treasuryWasm);
}
export async function sharedTreasuryWasm() {
  return readFile(/*turbopackIgnore: true*/ process.env.SHARED_TREASURY_WASM_PATH || resolve(process.cwd(), "../../packages/contracts/res/allocard_shared.wasm"));
}
export async function sharedTreasuryCodeHash() {
  return releaseHash(process.env.SHARED_TREASURY_WASM_PATH || "shared", sharedTreasuryWasm);
}

export async function legacyTreasuryCodeHash(shared: boolean, version = shared ? 3 : 2) {
  const name = shared ? `allocard_shared_v${version}.wasm` : `allocard_treasury_v${version}.wasm`;
  return releaseHash(name, () => readFile(/*turbopackIgnore: true*/ resolve(process.cwd(), "../../packages/contracts/res", name)));
}
