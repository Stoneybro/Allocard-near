import type { ParsedPolicyResult } from "./policy-engine";
import { emptyCaveatForm, validateCaveatForm, type CaveatForm } from "./policy-configuration";
import { TOKEN_SYMBOL } from "./chain";

/** Gate the supported employee flow separately from the broader policy compiler. */
export function reviewParsedPolicy(result: ParsedPolicyResult): ParsedPolicyResult {
  const questions = [...(result.clarificationQuestions ?? [])];
  const text = result.rawInput.toLowerCase();
  const periodNames: Record<string, string> = { hourly: "hour", daily: "day", weekly: "week", monthly: "month" };
  const requestedPeriods = new Set([...text.matchAll(/\b(?:per|every|each)\s+(hour|day|week|month)|\b(hourly|daily|weekly|monthly)\b/g)].map(match => periodNames[match[2]] || match[1]));
  if (requestedPeriods.size > 1) questions.push("This flow supports one recurring allowance. Choose one period rather than overlapping hourly, daily, weekly, or monthly limits.");
  if (/\b(?:require|needs?|with)\s+(?:\w+\s+)?(?:approval|sign-off)\b|\bapproved by\b/.test(text)) questions.push("Approval workflows are not supported in this employee payment flow. Remove the approval requirement before continuing.");
  if (/\bexpir(?:e|es|ation)\s+(?:in|on|after|at)|\bvalid for\b/.test(text) && !result.formValues.expiresAt) questions.push("An expiration was requested but could not be interpreted. Specify a clear future date or duration.");
  if (/\b(?:limit to|up to|max(?:imum)?)\s+\d+\s+(?:transactions|payments|calls)\b/.test(text) && !result.formValues.limitedCallsEnabled) questions.push("The requested transaction count was not understood. Specify a positive whole number of payments.");
  if (/\b(?:only to|recipients? only|restricted to accounts)\b/.test(text) && !result.formValues.allowedTargets.trim()) questions.push("Provide the exact NEAR recipient accounts; the requested recipient restriction could not be applied.");
  const currencies = [...text.matchAll(/\b\d+(?:\.\d+)?\s*(near|usdc|usd|eth|btc|eur|gbp|ngn)\b/g)].map(match => match[1].toUpperCase());
  if (currencies.some(currency => currency !== TOKEN_SYMBOL)) questions.push(`This treasury spends ${TOKEN_SYMBOL}. State all monetary limits in ${TOKEN_SYMBOL}; currency conversion is not supported.`);
  if (result.provider !== "near-ai") questions.push("AI is unavailable or returned an unreadable response. Try again or use manual configuration; no guessed settings have been applied.");
  if (!Number.isFinite(result.confidence) || result.confidence < 0.85) questions.push("The total budget could not be interpreted confidently. State the amount clearly; other spending limits are optional.");
  const form: CaveatForm = { ...emptyCaveatForm, ...result.formValues, expiresAt: result.formValues.expiresAt || "" };
  const errors = validateCaveatForm(form, null);
  questions.push(...Object.entries(errors).filter(([key]) => key !== "allowedTargetsWarning").map(([, message]) => message!));
  if (result.onChainSpec.rules.some(rule => rule.approval || rule.streaming || rule.min_per_action)) questions.push("This employee payment flow does not support approval, streaming, or minimum-payment requirements. Remove them or use a supported policy.");
  if (!result.success) questions.push(...result.warnings);
  // Compiler warnings can describe dropped accounts or expiry. They must be
  // resolved rather than hidden behind a generic successful review.
  if (result.warnings.some(warning => /skipped|omitted|invalid|ambig|conflict|assum|unrecognized|unsupported/i.test(warning))) questions.push(...result.warnings);
  const warnings = [...result.warnings];
  if (result.semanticGuardrails) warnings.push(`Instructions about expense purpose or receipts are advisory and are not enforced by this on-chain permission: ${result.semanticGuardrails}`);
  return { ...result, warnings: [...new Set(warnings)], success: result.success && questions.length === 0, clarificationQuestions: [...new Set(questions)] };
}
