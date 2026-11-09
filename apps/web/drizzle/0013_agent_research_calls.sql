CREATE TABLE "agent_research_calls" (
 "job_id" uuid PRIMARY KEY REFERENCES agent_research_tasks(id),
 "call_id" text NOT NULL,
 "session_id" text NOT NULL,
 "result" text,
 "created_at" timestamptz NOT NULL DEFAULT now()
);
