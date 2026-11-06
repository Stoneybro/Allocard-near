import { config } from "dotenv";
import { neon, neonConfig } from "@neondatabase/serverless";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { neonFetch } from "../lib/db/transport.mjs";
neonConfig.fetchFunction = neonFetch;
config({ path: ".env.local", quiet: true });
const keys = ["DATABASE_URL", "ALLOCARD_STORAGE_DATABASE_URL", "ALLOCARD_STORAGE_DATABASE_URL_UNPOOLED", "ALLOCARD_STORAGE_POSTGRES_URL", "POSTGRES_URL", "POSTGRES_URL_NON_POOLING"];
const key = keys.find(key => process.env[key]);
if (!key) { console.error("No database URL configured."); process.exit(1); }
console.log(`Migrating via Neon HTTP using ${key} (value hidden).`);
try {
  // Keep Drizzle's existing journal, hashes, and migration tracking format.
  const migrations = readMigrationFiles({ migrationsFolder: "./drizzle" });
  const sql = neon(process.env[key]);
  await sql`CREATE SCHEMA IF NOT EXISTS drizzle`;
  await sql`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id SERIAL PRIMARY KEY, hash text NOT NULL, created_at bigint)`;
  const rows = await sql`SELECT created_at FROM drizzle.__drizzle_migrations ORDER BY created_at DESC LIMIT 1`;
  const last = rows[0] ? Number(rows[0].created_at) : null;
  if (last !== null && !Number.isSafeInteger(last)) throw new Error("Invalid migration journal timestamp");
  const pending = migrations.filter(migration => last === null || migration.folderMillis > last);
  if (!pending.length) { console.log("Database migrations are up to date."); }
  else {
    const queries = [sql`SELECT pg_advisory_xact_lock(1095519300)`];
    // Fail safely if another migration process changed the journal after our read.
    queries.push(sql.query(`DO $migration_guard$ BEGIN IF (SELECT max(created_at) FROM drizzle.__drizzle_migrations) IS DISTINCT FROM ${last === null ? 'NULL::bigint' : String(last)} THEN RAISE EXCEPTION 'Migration journal changed; rerun db:migrate'; END IF; END $migration_guard$`));
    for (const migration of pending) {
      for (const statement of migration.sql) if (statement.trim()) queries.push(sql.query(statement));
      queries.push(sql`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES (${migration.hash}, ${migration.folderMillis})`);
    }
    // All pending DDL and journal entries commit together, or roll back together.
    await sql.transaction(queries);
    console.log(`Applied ${pending.length} migrations successfully. Run db:check next.`);
  }
} catch (error) {
  const code = typeof error.code === "string" && /^[A-Z0-9]{5}$/.test(error.code) ? error.code : "unavailable";
  console.error(`Migration failed (SQLSTATE: ${code}). Connection details and query parameters are hidden.`);
  if (code === "42P07" || code === "42710" || code === "42701") console.error("An existing database object conflicts with the migration history. Do not reset or drop tables; inspect the schema and journal first.");
  else if (code === "42P01") console.error("A migration references a missing table. Check the migration history and table creation order; this is a schema error, not a connection failure.");
  else if (code === "28P01") console.error("Check the database credentials.");
  else if (code === "42501") console.error("The configured database user needs schema and table creation permissions.");
  else console.error("Check database connectivity. If another migration process was running, retry after it finishes.");
  process.exitCode = 1;
}
