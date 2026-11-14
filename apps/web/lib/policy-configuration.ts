import { parseTokenAmount, type PermissionSpec } from "@allocard/delegation-sdk";
import { MOCK_USDC_ACCOUNT_ID, SPENDING_ASSET, SPENDING_DECIMALS, TOKEN_SYMBOL } from "./chain";
import { isValidWalletAddress } from "./wallet";

export type CaveatForm = {
  maxAmountNear: string;
  period: "none" | "hourly" | "daily" | "weekly" | "monthly";
  periodAmountNear: string;
  perTransactionCapNear: string;
  allowedTargets: string;
  limitedCallsEnabled: boolean;
  limitedCalls: string;
  policyPrompt: string;
  expiresAt: string;
};
export const emptyCaveatForm: CaveatForm = {
  maxAmountNear: "", period: "none", periodAmountNear: "", perTransactionCapNear: "",
  allowedTargets: "", limitedCallsEnabled: false, limitedCalls: "1", policyPrompt: "", expiresAt: "",
};
export const periodDurations = { hourly: 3600, daily: 86400, weekly: 604800, monthly: 2592000 };
export function splitAddresses(value: string) { return value.split(/[\n,]/).map(item => item.trim().toLowerCase()).filter(Boolean); }
export type FormErrors = Partial<Record<keyof CaveatForm | "allowedTargetsWarning", string>>;
export function hasFormErrors(errors: FormErrors) { return Object.keys(errors).some(key => key !== "allowedTargetsWarning"); }

export function validateCaveatForm(form: CaveatForm, balance: string | null, now = Date.now(), recovering = false): FormErrors {
  const errors: FormErrors = {};
  const amount = (key: "maxAmountNear" | "periodAmountNear" | "perTransactionCapNear", required: boolean) => {
    if (!required && !form[key].trim()) return null;
    try {
      const value = BigInt(parseTokenAmount(form[key].trim(), SPENDING_DECIMALS));
      if (value <= 0n) throw new Error("Amount must be greater than zero");
      return value;
    } catch (error) {
      errors[key] = `${error instanceof Error ? error.message : "Invalid amount"}. Use ${TOKEN_SYMBOL} with up to ${SPENDING_DECIMALS} decimal places.`;
      return null;
    }
  };
  const total = amount("maxAmountNear", true);
  const periodic = form.period !== "none" ? amount("periodAmountNear", true) : null;
  if (!["none", "hourly", "daily", "weekly", "monthly"].includes(form.period)) errors.period = "Choose a supported recurring period.";
  const perTx = amount("perTransactionCapNear", false);
  if (total !== null && balance !== null) {
    try { if (total > BigInt(parseTokenAmount(balance, SPENDING_DECIMALS))) errors.maxAmountNear = `Only ${balance} ${TOKEN_SYMBOL} is available to delegate.`; }
    catch { errors.maxAmountNear = "Refresh the treasury balance before continuing."; }
  }
  if (form.period !== "none" && periodic !== null && total !== null && periodic > total) errors.periodAmountNear = "The recurring allowance cannot exceed the total budget.";
  const ceiling = form.period !== "none" ? periodic : total;
  if (perTx !== null && ceiling !== null && perTx > ceiling) errors.perTransactionCapNear = "The per-payment cap cannot exceed the recurring allowance or total budget.";
  if (form.limitedCallsEnabled && (!/^\d+$/.test(form.limitedCalls.trim()) || !Number.isSafeInteger(Number(form.limitedCalls)) || Number(form.limitedCalls) < 1 || Number(form.limitedCalls) > 4294967295)) errors.limitedCalls = "Enter a whole transaction count from 1 to 4,294,967,295.";
  const addresses = splitAddresses(form.allowedTargets);
  if (addresses.length > 64) errors.allowedTargets = "Use at most 64 recipient accounts.";
  else if (addresses.some(address => !isValidWalletAddress(address))) errors.allowedTargets = "Enter valid NEAR accounts, separated by commas or new lines.";
  else if (new Set(addresses).size !== addresses.length) errors.allowedTargets = "Remove duplicate recipient accounts.";
  else if (!addresses.length) errors.allowedTargetsWarning = "Payments to any recipient will be allowed.";
  if (form.expiresAt && (!Number.isFinite(Date.parse(form.expiresAt)) || (!recovering && Date.parse(form.expiresAt) <= now))) errors.expiresAt = "Choose an expiration in the future.";
  if (form.policyPrompt.length > 6000) errors.policyPrompt = "Keep the policy within 6,000 characters.";
  return errors;
}

export function buildPolicySpec(form: CaveatForm, delegate: string, now = Date.now()): PermissionSpec {
  if (hasFormErrors(validateCaveatForm(form, null, now))) throw new Error("Resolve policy errors before signing.");
  const recipients = splitAddresses(form.allowedTargets);
  return {
    delegate, valid_from_ms: String(now), expires_at_ms: form.expiresAt ? String(Date.parse(form.expiresAt)) : null,
    max_executions: form.limitedCallsEnabled ? Number(form.limitedCalls) : null,
    rules: [{ asset: SPENDING_ASSET, recipients: recipients.length ? { type: "Only", accounts: recipients } : { type: "Any" },
      min_per_action: null, max_per_action: form.perTransactionCapNear.trim() ? parseTokenAmount(form.perTransactionCapNear.trim(), SPENDING_DECIMALS) : null,
      lifetime_limit: parseTokenAmount(form.maxAmountNear.trim(), SPENDING_DECIMALS),
      fixed_window: form.period === "none" ? null : { limit: parseTokenAmount(form.periodAmountNear.trim(), SPENDING_DECIMALS), duration_ms: String(periodDurations[form.period] * 1000), anchor_ms: String(now) },
      streaming: null, approval: null, acknowledge_unbounded_budget: false }],
    redelegation_depth: 1, metadata_hash: null,
  };
}

const demoAmounts = MOCK_USDC_ACCOUNT_ID ? ["500", "100", "50"] : ["0.5", "0.1", "0.05"];
export const DEMO_POLICY = `Give this employee a total budget of ${demoAmounts[0]} ${TOKEN_SYMBOL}. Allow ${demoAmounts[1]} ${TOKEN_SYMBOL} per week, with a cap of ${demoAmounts[2]} ${TOKEN_SYMBOL} per transaction. Allow payments only to vendor.testnet and supplier.testnet. Limit to 20 transactions. Expire in 30 days.`;
