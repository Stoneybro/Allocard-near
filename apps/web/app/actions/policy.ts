"use server";

import { requireSessionUser, requireEmployeeCompany } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { companies, delegations, agents } from "@/lib/db/schema";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { reviewParsedPolicy } from "@/lib/policy-review";
import { isValidNearAccountId } from "@/lib/policy-engine";
import {
  parseNaturalLanguagePolicy,
  validatePermissionSpec,
  type ParsedPolicyResult,
  type ValidatePolicyResult,
} from "@/lib/policy-engine";
import type { PermissionSpec } from "@allocard/delegation-sdk";

export async function parsePolicyWithNearAI(input: {
  text: string;
  delegateAccount?: string;
  companyId?: string;
  delegationId?: string;
}): Promise<ParsedPolicyResult> {
  const user = await requireSessionUser();
  const parsed = z.object({ text: z.string().trim().min(1).max(6000),
    delegateAccount: z.string().refine(isValidNearAccountId, "A valid employee account is required"),
    companyId: z.string().uuid(),
    delegationId: z.string().uuid().optional(),
  }).safeParse(input);
  if (!parsed.success) throw new Error("Enter a policy of 1–6,000 characters, a valid employee account, and a company.");
  input = parsed.data;

  let companyPolicy: string | null = null;
  if (input.delegationId) {
    await requireEmployeeCompany(user.id, input.companyId!);
    const [child] = await db.select().from(delegations).where(and(eq(delegations.id, input.delegationId), eq(delegations.delegatorType, "user"), eq(delegations.delegatorId, user.id), eq(delegations.delegateeType, "agent"), eq(delegations.status, "pending_config"))).limit(1);
    if (!child?.parentDelegationId || !child.delegateeId) throw new Error("Forbidden: select your own pending agent policy.");
    const [[parent], [agent], [company]] = await Promise.all([
      db.select().from(delegations).where(and(eq(delegations.id, child.parentDelegationId), eq(delegations.delegatorType, "company"), eq(delegations.delegatorId, input.companyId!), eq(delegations.delegateeType, "user"), eq(delegations.delegateeId, user.id), eq(delegations.status, "active"))).limit(1),
      db.select().from(agents).where(and(eq(agents.id, child.delegateeId), eq(agents.isActive, true))).limit(1),
      db.select({ companyPolicy: companies.companyPolicy }).from(companies).where(eq(companies.id, input.companyId!)).limit(1),
    ]);
    if (!parent || !agent || agent.smartAccountAddress !== input.delegateAccount || !company) throw new Error("Forbidden: this agent policy does not belong to your active company allowance.");
    companyPolicy = [company.companyPolicy || "", `The employer's allowance also applies to every agent payment: ${JSON.stringify(parent.signedDelegation)}`].join("\n");
  } else
  if (input.companyId) {
    const [co] = await db
      .select({ companyPolicy: companies.companyPolicy })
      .from(companies)
      .where(and(eq(companies.id, input.companyId), eq(companies.ownerId, user.id)))
      .limit(1);
    if (!co) throw new Error("Forbidden: only the company owner can configure this policy.");
    companyPolicy = co.companyPolicy ?? null;
  }

  return reviewParsedPolicy(await parseNaturalLanguagePolicy({
    text: input.text,
    delegateAccount: input.delegateAccount,
    companyId: input.companyId,
    companyPolicy,
  }));
}

export async function validatePolicySpecAction(
  spec: PermissionSpec,
): Promise<ValidatePolicyResult> {
  return validatePermissionSpec(spec);
}
