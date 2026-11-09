import { config } from "dotenv";
import { readFileSync, appendFileSync, writeFileSync, existsSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { KeyPair } from "near-api-js";
import { neon, neonConfig } from "@neondatabase/serverless";
import { neonFetch } from "../lib/db/transport.mjs";
neonConfig.fetchFunction=neonFetch;
config({path:'.env.local',quiet:true});
const envFile='.env.local';
const append=(key,value)=>{appendFileSync(envFile,`\n${key}=${value}\n`,{mode:0o600});process.env[key]=value;};
if(!process.env.ALLOCARD_AGENT_SECRET)append('ALLOCARD_AGENT_SECRET',randomBytes(32).toString('base64url'));
if(!process.env.ALLOCARD_AGENT_URL)append('ALLOCARD_AGENT_URL','https://purchasing-research-agent-v2.vercel.app');
if(!process.env.NEAR_ADAPTER_ACCOUNT_ID){
 const key=KeyPair.fromRandom('ed25519');
 const account=Buffer.from(key.getPublicKey().data).toString('hex');
 append('NEAR_ADAPTER_ACCOUNT_ID',account);append('NEAR_ADAPTER_PRIVATE_KEY',key.toString());
}
if(process.argv.includes('--register')){
 const account=process.env.NEAR_ADAPTER_ACCOUNT_ID;
 if(!/^[0-9a-f]{64}$/.test(account))throw new Error('This setup expects the generated implicit adapter identity');
 const url=process.env.DATABASE_URL||process.env.ALLOCARD_STORAGE_DATABASE_URL;if(!url)throw new Error('Database configuration missing');
 const sql=neon(url);
 await sql`INSERT INTO agents(name, description, smart_account_address, signer_address, is_active) VALUES ('Allocard Purchasing Research Adapter','Business software research; direct demo execution with no marketplace charge',${account},${account},true) ON CONFLICT(smart_account_address) DO UPDATE SET name=excluded.name,description=excluded.description,signer_address=excluded.signer_address,is_active=true`;
 console.log('Registered the adapter public identity. Employee authorization is required to create each child permission.');
}
if(process.argv.includes('--worker-env')){
 writeFileSync('.env.agent-worker.local',`ALLOCARD_AGENT_SECRET=${process.env.ALLOCARD_AGENT_SECRET}\nNEARAI_MODEL=Qwen/Qwen3.8-27B\n`,{mode:0o600});
 console.log('Wrote ignored .env.agent-worker.local for secure configuration of the agent project; no credentials printed.');
}
console.log('Local adapter configuration is present. No funds were transferred and no model calls were made.');
