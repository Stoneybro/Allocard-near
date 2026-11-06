ALTER TABLE "companies" ADD COLUMN IF NOT EXISTS "company_policy" text;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "agent_bookings" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "delegation_id" uuid NOT NULL REFERENCES "delegations"("id") ON DELETE cascade,
  "agent_id" uuid NOT NULL REFERENCES "agents"("id") ON DELETE cascade,
  "employee_id" uuid NOT NULL REFERENCES "users"("id") ON DELETE cascade,
  "company_id" uuid NOT NULL REFERENCES "companies"("id") ON DELETE cascade,
  "booking_details" jsonb NOT NULL,
  "amount_eth" numeric NOT NULL,
  "tx_hash" text,
  "venice_prompt" text,
  "venice_reasoning" text,
  "venice_confidence" double precision,
  "created_at" timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_bookings_delegation_id_idx" ON "agent_bookings" ("delegation_id");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "agent_bookings_employee_id_idx" ON "agent_bookings" ("employee_id");
