"use server";

import { requireSessionUser } from "@/lib/auth-guard";
import { db } from "@/lib/db";
import { companies } from "@/lib/db/schema";
import { eq } from "drizzle-orm";
import {
  parseNaturalLanguagePolicy,
  validatePermissionSpec,
  synthesizeCompanyPolicy,
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

export async function generateCompanyPolicyAction(input: {
  prompt: string;
  companyId?: string;
}): Promise<{ policy: string; summary: string }> {
  await requireSessionUser();

  let currentPolicy: string | null = null;
  let companyName: string = "Organization";

  if (input.companyId) {
    const [co] = await db
      .select({ companyPolicy: companies.companyPolicy, name: companies.name })
      .from(companies)
      .where(eq(companies.id, input.companyId))
      .limit(1);
    currentPolicy = co?.companyPolicy ?? null;
    if (co?.name) companyName = co.name;
  }

  return synthesizeCompanyPolicy({
    prompt: input.prompt,
    currentPolicy,
    companyName,
  });
}

