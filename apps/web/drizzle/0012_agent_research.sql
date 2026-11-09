CREATE TABLE "agent_research_tasks" (
 "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "company_id" uuid NOT NULL REFERENCES companies(id), "employee_id" uuid NOT NULL REFERENCES users(id), "delegation_id" uuid NOT NULL REFERENCES delegations(id), "request_id" uuid NOT NULL,
 "prompt" text NOT NULL, "digest" text NOT NULL, "state" text NOT NULL DEFAULT 'proposal', "result" text, "message" text,
 "reserved_micros" numeric(20,0) NOT NULL DEFAULT 0, "worker_session" text,
 "created_at" timestamptz NOT NULL DEFAULT now(), "approved_at" timestamptz, "expires_at" timestamptz NOT NULL, "started_at" timestamptz,
 CONSTRAINT research_valid_state CHECK (state IN ('proposal','queued','dispatching','running','delivered','failed','cancelled','expired','needs_reconciliation')),
 CONSTRAINT research_nonnegative_reserve CHECK (reserved_micros >= 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX research_employee_request_unique ON agent_research_tasks(employee_id, request_id);
--> statement-breakpoint
CREATE INDEX research_company_employee_idx ON agent_research_tasks(company_id, employee_id);
--> statement-breakpoint
CREATE INDEX research_state_idx ON agent_research_tasks(state);
