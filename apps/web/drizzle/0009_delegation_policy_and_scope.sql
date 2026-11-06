ALTER TABLE "delegations" ADD COLUMN IF NOT EXISTS "policy_prompt" text;
--> statement-breakpoint
ALTER TABLE "delegations" ADD COLUMN IF NOT EXISTS "treasury_reference" text;
--> statement-breakpoint
-- Carry the company treasury reference down existing delegation trees.
WITH RECURSIVE scoped AS (
  SELECT d.id, c.smart_account_address AS treasury_reference, ARRAY[d.id] AS path
  FROM delegations d JOIN companies c ON d.delegator_type = 'company' AND d.delegator_id = c.id
  WHERE c.smart_account_address IS NOT NULL
  UNION ALL
  SELECT child.id, parent.treasury_reference, parent.path || child.id
  FROM delegations child JOIN scoped parent ON child.parent_delegation_id = parent.id
  WHERE NOT child.id = ANY(parent.path) AND child.delegator_type <> 'company'
)
UPDATE delegations d SET treasury_reference = scoped.treasury_reference
FROM scoped WHERE scoped.id = d.id AND d.treasury_reference IS NULL;
--> statement-breakpoint
DROP INDEX IF EXISTS "delegations_delegation_hash_unique";
--> statement-breakpoint
CREATE UNIQUE INDEX "delegations_treasury_permission_unique" ON "delegations" ("treasury_reference", "delegation_hash");
