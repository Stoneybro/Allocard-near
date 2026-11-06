CREATE TABLE IF NOT EXISTS "near_sponsor_limits" (
  "bucket" text PRIMARY KEY,
  "used" numeric(20, 0) NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "near_sponsor_jobs" (
  "id" text PRIMARY KEY,
  "actor" text NOT NULL,
  "intent_hash" text NOT NULL,
  "relayer_id" text NOT NULL,
  "state" text NOT NULL DEFAULT 'reserved',
  "transaction_hash" text,
  "signed_transaction" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "near_sponsor_jobs_transaction_idx" ON "near_sponsor_jobs" ("transaction_hash");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "near_sponsor_keys" (
  "key" text PRIMARY KEY,
  "nonce" numeric(20, 0) NOT NULL,
  "lease_until" timestamp with time zone NOT NULL
);
