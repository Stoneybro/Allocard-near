CREATE TABLE "auth_sessions" (
  "token_hash" text PRIMARY KEY, "provider_session_hash" text NOT NULL,
  "provider_user_id" text NOT NULL, "wallet_address" text NOT NULL, "email" text NOT NULL,
  "created_at" timestamptz NOT NULL DEFAULT now(), "last_seen_at" timestamptz NOT NULL DEFAULT now(),
  "expires_at" timestamptz NOT NULL, "revoked_at" timestamptz
);
--> statement-breakpoint
CREATE INDEX "auth_sessions_provider_idx" ON "auth_sessions" ("provider_session_hash");
--> statement-breakpoint
CREATE INDEX "auth_sessions_expiry_idx" ON "auth_sessions" ("expires_at");
--> statement-breakpoint
CREATE TABLE "revoked_provider_sessions" ("provider_session_hash" text PRIMARY KEY, "revoked_at" timestamptz NOT NULL DEFAULT now());
--> statement-breakpoint
CREATE TABLE "reimbursement_jobs" (
  "id" text PRIMARY KEY, "intent_hash" text NOT NULL,
  "company_id" uuid NOT NULL REFERENCES "companies"("id"), "employee_id" uuid NOT NULL REFERENCES "users"("id"),
  "agent_id" uuid NOT NULL REFERENCES "agents"("id"), "delegation_id" uuid NOT NULL REFERENCES "delegations"("id"),
  "treasury" text NOT NULL, "actor" text NOT NULL, "recipient" text NOT NULL, "amount_yocto" numeric(78,0) NOT NULL,
  "description" text NOT NULL, "request" jsonb NOT NULL, "state" text NOT NULL DEFAULT 'reviewing', "review" jsonb,
  "lease_token" text NOT NULL, "lease_until" timestamptz NOT NULL,
  "signed_transaction" text, "transaction_hash" text, "execution_id" text, "created_at" timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT "reimbursement_jobs_state_check" CHECK (state IN ('reviewing','approved','submitted','paid','rejected','failed')),
  CONSTRAINT "reimbursement_jobs_amount_check" CHECK (amount_yocto > 0)
);
--> statement-breakpoint
CREATE INDEX "reimbursement_jobs_employee_idx" ON "reimbursement_jobs" ("employee_id");
--> statement-breakpoint
CREATE INDEX "reimbursement_jobs_company_idx" ON "reimbursement_jobs" ("company_id");
--> statement-breakpoint
ALTER TABLE "claim_redemptions" ADD COLUMN "reimbursement_job_id" text REFERENCES "reimbursement_jobs"("id");
--> statement-breakpoint
ALTER TABLE "claim_redemptions" ADD COLUMN "asset_network" text NOT NULL DEFAULT 'legacy:unknown';
--> statement-breakpoint
ALTER TABLE "agent_bookings" ADD COLUMN "asset_network" text NOT NULL DEFAULT 'legacy:unknown';
--> statement-breakpoint
ALTER TABLE "manual_transactions" ADD COLUMN "asset_network" text NOT NULL DEFAULT 'legacy:unknown';
--> statement-breakpoint
CREATE UNIQUE INDEX "claim_redemptions_job_unique" ON "claim_redemptions" ("reimbursement_job_id");

--> statement-breakpoint
CREATE INDEX "manual_transactions_activity_idx" ON "manual_transactions" ("company_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "agent_bookings_activity_idx" ON "agent_bookings" ("company_id", "created_at" DESC, "id" DESC);
--> statement-breakpoint
CREATE INDEX "claim_redemptions_activity_idx" ON "claim_redemptions" ("company_id", "created_at" DESC, "id" DESC);
