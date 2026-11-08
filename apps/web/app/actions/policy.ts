"use server";

import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
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
  await requireSessionUser();

  let companyPolicy: string | null = null;
  if (input.companyId) {
    const [co] = await db
      .select({ companyPolicy: companies.companyPolicy })
      .from(companies)
      .where(eq(companies.id, input.companyId))
      .limit(1);
    companyPolicy = co?.companyPolicy ?? null;
  }

  return parseNaturalLanguagePolicy({
    text: input.text,
    delegateAccount: input.delegateAccount,
    companyId: input.companyId,
    companyPolicy,
  });
}

export async function validatePolicySpecAction(
  spec: PermissionSpec,
): Promise<ValidatePolicyResult> {
  return validatePermissionSpec(spec);
}
