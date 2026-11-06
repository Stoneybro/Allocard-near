-- This table previously existed only in schema.ts, so fresh databases need it.
CREATE TABLE IF NOT EXISTS "manual_transactions" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "employee_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "delegation_id" uuid NOT NULL REFERENCES "delegations"("id") ON DELETE cascade,
  "to_address" text NOT NULL,
  "amount_eth" numeric NOT NULL,
  "purpose" text NOT NULL,
  "is_flagged" boolean NOT NULL DEFAULT false,
  "tx_hash" text,
  "receipt_summary" text,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_transactions_delegation_id_idx" ON "manual_transactions" ("delegation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_transactions_employee_id_idx" ON "manual_transactions" ("employee_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "manual_transactions_company_id_idx" ON "manual_transactions" ("company_id");
--> statement-breakpoint
ALTER TABLE "manual_transactions" ADD COLUMN "treasury_contract_id" text;
--> statement-breakpoint
ALTER TABLE "manual_transactions" ADD COLUMN "execution_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "manual_transactions_treasury_execution_unique" ON "manual_transactions" ("treasury_contract_id", "execution_id");
--> statement-breakpoint
CREATE TABLE "consumed_login_nonces" ("nonce_hash" text PRIMARY KEY NOT NULL, "expires_at" timestamp with time zone NOT NULL);
--> statement-breakpoint
CREATE INDEX "consumed_login_nonces_expiry_idx" ON "consumed_login_nonces" ("expires_at");
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "near_account_id" text;
--> statement-breakpoint
CREATE UNIQUE INDEX "users_near_account_id_unique" ON "users" ("near_account_id");
