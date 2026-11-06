import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { readMigrationFiles } from "drizzle-orm/migrator";
import { getTableConfig, PgTable } from "drizzle-orm/pg-core";
import { is } from "drizzle-orm";
import * as schema from "@/lib/db/schema";
const migrations = readMigrationFiles({ migrationsFolder: fileURLToPath(new URL("../drizzle", import.meta.url)) });
const statements = migrations.flatMap(m => m.sql);
describe("fresh database migration coverage", () => {
  it("creates every table in the application schema", () => {
    const created = new Set([...statements.join("\n").matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/gi)].map(match => match[1]));
    for (const table of Object.values(schema)) if (is(table, PgTable)) expect(created.has(getTableConfig(table).name), getTableConfig(table).name).toBe(true);
  });
  it("creates a table before altering it", () => {
    const created = new Set<string>();
    for (const statement of statements) {
      for (const match of statement.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/gi)) created.add(match[1]);
      for (const match of statement.matchAll(/ALTER TABLE\s+"([^"]+)"/gi)) expect(created.has(match[1]), match[1]).toBe(true);
    }
  });
  it("includes the company policy column", () => {
    expect(statements.join("\n")).toMatch(/ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "company_policy" text/);
  });
});


describe("complete application column coverage", () => {
  const expected = Object.fromEntries(Object.values(schema).filter(table => is(table, PgTable)).map(table => {
    const config = getTableConfig(table as PgTable);
    return [config.name, config.columns.map(column => column.name).sort()];
  }));
  it("keeps the read-only database check synchronized with the Drizzle schema", () => {
    const manifest = JSON.parse(readFileSync(new URL("../lib/db/schema-columns.json", import.meta.url), "utf8"));
    expect(manifest).toEqual(expected);
  });
  it("includes a migration for every application column", () => {
    const sql = statements.join("\n");
    const columns = new Set<string>();
    for (const table of sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?(?:"public"\.)?"([^"]+)"\s*\(([\s\S]*?)\)\s*;/gi)) {
      for (const field of table[2].matchAll(/(?:^|,)\s*"([^"]+)"\s+[a-z"]/gi)) columns.add(`${table[1]}.${field[1]}`);
    }
    for (const field of sql.matchAll(/ALTER TABLE\s+(?:"public"\.)?"([^"]+)"\s+ADD COLUMN\s+(?:IF NOT EXISTS\s+)?"([^"]+)"/gi)) columns.add(`${field[1]}.${field[2]}`);
    for (const [table, names] of Object.entries(expected)) for (const name of names) expect(columns.has(`${table}.${name}`), `${table}.${name}`).toBe(true);
  });
  it("scopes permission uniqueness to the company treasury reference", () => {
    const config = getTableConfig(schema.delegations);
    const unique = config.indexes.filter(index => index.config.unique);
    expect(unique).toHaveLength(1);
    expect(unique[0].config.columns.map(column => "name" in column ? column.name : "expression")).toEqual(["treasury_reference", "delegation_hash"]);
    expect(statements.join("\n")).toContain('DROP INDEX IF EXISTS "delegations_delegation_hash_unique"');
  });
});
