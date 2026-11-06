import { readFileSync } from "node:fs";
import { config } from "dotenv";
import { neon, neonConfig } from "@neondatabase/serverless";
import { neonFetch } from "../lib/db/transport.mjs";
neonConfig.fetchFunction = neonFetch;
config({ path: ".env.local", quiet: true });
const keys = ["DATABASE_URL", "ALLOCARD_STORAGE_DATABASE_URL", "ALLOCARD_STORAGE_DATABASE_URL_UNPOOLED", "ALLOCARD_STORAGE_POSTGRES_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"];
const key = keys.find(key => process.env[key]);
if (!key) {
  console.error("No database URL is configured in the environment or .env.local.");
  process.exit(1);
}
console.log(`Using ${key} (value hidden).`);
try {
  const sql = neon(process.env[key]);
  const columns = await sql`select table_name, column_name from information_schema.columns where table_schema = 'public'`;
  console.log("Database connection succeeded.");
  const schema = JSON.parse(readFileSync(new URL("../lib/db/schema-columns.json", import.meta.url), "utf8"));
  const required = Object.entries(schema).flatMap(([table, names]) => names.map(name => `${table}.${name}`));
  const found = new Set(columns.map(row => `${row.table_name}.${row.column_name}`));
  const missing = required.filter(column => !found.has(column));
  if (missing.length) {
    console.error(`Missing schema fields: ${missing.join(", ")}`);
    console.error("Run pnpm --filter @allocard/web db:migrate from the repository root, then run db:check again.");
    process.exitCode = 1;
  } else console.log(`All ${required.length} application schema fields across ${Object.keys(schema).length} tables are present.`);
} catch (error) {
  const code = typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : "unavailable";
  console.error(`Database connection failed (SQLSTATE: ${code}). Check database availability, URL credentials, and network access. No credentials or query parameters are printed.`);
  process.exitCode = 1;
}
