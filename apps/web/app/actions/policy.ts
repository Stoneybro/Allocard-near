"use server";

import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
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
}): Promise<ParsedPolicyResult> {
  const user = await requireSessionUser();
  const parsed = z.object({ text: z.string().trim().min(1).max(6000),
    delegateAccount: z.string().refine(isValidNearAccountId, "A valid employee account is required"),
    companyId: z.string().uuid(),
  }).safeParse(input);
  if (!parsed.success) throw new Error("Enter a policy of 1–6,000 characters, a valid employee account, and a company.");
  input = parsed.data;

  let companyPolicy: string | null = null;
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
