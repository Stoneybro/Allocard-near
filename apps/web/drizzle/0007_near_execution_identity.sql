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
