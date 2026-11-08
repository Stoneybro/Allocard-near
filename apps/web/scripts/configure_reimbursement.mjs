import { config } from "dotenv";
import { neon } from "@neondatabase/serverless";
import { KeyPair } from "near-api-js";
config({ path: ".env.local", quiet: true });
const account = process.env.NEAR_REIMBURSEMENT_ACCOUNT_ID;
if (!account || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(account) || account.startsWith("0x") || account.length < 2 || account.length > 64) throw new Error("Set a valid NEAR_REIMBURSEMENT_ACCOUNT_ID");
const key = KeyPair.fromString(process.env.NEAR_REIMBURSEMENT_PRIVATE_KEY || "");
const rpcUrl = process.env.NEAR_RPC_URL || process.env.NEXT_PUBLIC_NEAR_RPC_URL || "https://rpc.testnet.near.org";
async function rpc(method, params) {
  const response = await fetch(rpcUrl, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "setup", method, params }), signal: AbortSignal.timeout(15_000) });
  const value = await response.json(); if (!response.ok || value.error) throw new Error("Could not verify reimbursement account on NEAR RPC"); return value.result;
}
if ((await rpc("status", {})).chain_id !== "testnet") throw new Error("This setup only supports NEAR testnet");
const access = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: account, public_key: key.getPublicKey().toString() });
if (access.permission !== "FullAccess") throw new Error("Configure a registered regular FullAccess reimbursement key");
const url = process.env.DATABASE_URL || process.env.ALLOCARD_STORAGE_DATABASE_URL;
if (!url) throw new Error("Database configuration is required");
const sql = neon(url);
await sql`insert into agents (name, description, smart_account_address, signer_address, is_active) values ('Reimbursement Agent', 'Verified NEAR reimbursement executor', ${account}, ${account}, true) on conflict (smart_account_address) do update set name = excluded.name, description = excluded.description, signer_address = excluded.signer_address, is_active = true`;
console.log("Registered the verified NEAR reimbursement account. The employer must authorize its budget before payouts.");
