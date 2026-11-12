"use client";

import { useEffect, useRef, useState } from "react";
import { LoaderCircleIcon, Sparkles, X } from "lucide-react";
import { Drawer, DrawerContent, DrawerDescription, DrawerFooter, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { CHAIN_NAME, TOKEN_SYMBOL } from "@/lib/chain";
import { DEMO_POLICY, emptyCaveatForm, hasFormErrors, splitAddresses, validateCaveatForm, type CaveatForm, type FormErrors } from "@/lib/policy-configuration";
import type { ParsedPolicyResult } from "@/lib/policy-engine";

type Props = {
  open: boolean; mobile: boolean; identity: string; account: string; companyId: string;
  status: string; form: CaveatForm; setForm: (form: CaveatForm) => void;
  balance: string | null; busy: boolean; stage: string; error: string | null;
  audience?: "employee" | "agent"; delegationId?: string; normalizeForm?: (form: CaveatForm) => CaveatForm;
  recovery: boolean; onClose: () => void; onActivate: () => void; onRevoke: () => void;
};

export function PolicyConfigurationDrawer(props: Props) {
  const { form, setForm, busy, status } = props;
  const agent = props.audience === "agent";
  const active = status === "active";
  const readOnly = active || status === "revoked";
  const [mode, setMode] = useState<"ai" | "manual" | "review">(props.recovery || readOnly ? "review" : "ai");
  const [prompt, setPrompt] = useState(form.policyPrompt || (agent ? `Give this agent a total budget of ${props.balance || "10"} ${TOKEN_SYMBOL}.` : DEMO_POLICY));
  const [parsing, setParsing] = useState(false);
  const [errors, setErrors] = useState<FormErrors>({});
  const [issues, setIssues] = useState<string[]>([]);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [acknowledged, setAcknowledged] = useState(false);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const controller = useRef<AbortController | null>(null);
  const generation = useRef(0);
  const errorRef = useRef<HTMLDivElement>(null);
  const reviewRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => () => { generation.current++; controller.current?.abort(); }, []);
  useEffect(() => { if (mode === "review") reviewRef.current?.focus(); }, [mode]);
  const locked = busy || parsing;
  const update = (key: keyof CaveatForm, value: string | boolean) => {
    setForm({ ...form, [key]: value });
    setErrors({}); setIssues([]); setAcknowledged(false);
  };
  const showErrors = (next: FormErrors) => {
    setErrors(next);
    requestAnimationFrame(() => errorRef.current?.focus());
  };
  const reviewManual = () => {
    let resolved = form;
    try { resolved = props.normalizeForm?.(form) ?? form; } catch (error) { setIssues([error instanceof Error ? error.message : "Check your employer's limits."]); return; }
    const next = validateCaveatForm(resolved, props.recovery ? null : props.balance, Date.now(), props.recovery);
    if (hasFormErrors(next)) { showErrors(next); return; }
    setForm(resolved);
    setWarnings(next.allowedTargetsWarning ? [next.allowedTargetsWarning] : []);
    setIssues([]); setAcknowledged(false); setMode("review");
  };
  const reviewAI = async () => {
    if (!prompt.trim()) { setIssues(["Describe a total budget and the rules you want to apply."]); return; }
    const request = ++generation.current;
    const abort = new AbortController(); controller.current = abort;
    const timer = setTimeout(() => abort.abort(), 45000);
    setParsing(true); setIssues([]); setErrors({});
    try {
      const response = await fetch("/api/policies/parse", { method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: prompt, delegateAccount: props.account, companyId: props.companyId, ...(agent ? { delegationId: props.delegationId } : {}) }), signal: abort.signal });
      const result = await response.json() as ParsedPolicyResult & { error?: string; clarificationQuestions?: string[] };
      if (request !== generation.current) return;
      if (!response.ok) throw new Error(result.error || "The policy could not be reviewed. Please try again.");
      if (!result.success || result.provider === "fallback-rules" || result.clarificationQuestions?.length) {
        setIssues(result.clarificationQuestions?.length ? result.clarificationQuestions : result.warnings?.length ? result.warnings : ["AI could not confidently interpret this policy. Add explicit amounts, recipients, and time limits, or configure it manually."]);
        return;
      }
      // Replace the entire draft: omitted rules must never retain stale restrictions.
      const parsedForm: CaveatForm = { ...emptyCaveatForm, ...result.formValues, expiresAt: result.formValues.expiresAt || "", policyPrompt: prompt };
      const next = props.normalizeForm?.(parsedForm) ?? parsedForm;
      const validation = validateCaveatForm(next, props.balance);
      if (hasFormErrors(validation)) { setIssues(Object.entries(validation).filter(([key]) => key !== "allowedTargetsWarning").map(([, message]) => message!)); return; }
      setForm(next); setWarnings([...result.warnings, ...(validation.allowedTargetsWarning ? [validation.allowedTargetsWarning] : [])]);
      setAcknowledged(false); setMode("review");
    } catch (error) {
      if (request === generation.current) setIssues([abort.signal.aborted ? "AI review timed out. Try again or configure the policy manually." : error instanceof Error ? error.message : "AI review failed. Try again or use manual setup."]);
    } finally { clearTimeout(timer); if (request === generation.current) setParsing(false); }
  };
  const localDate = (value: string) => {
    if (!value || !Number.isFinite(Date.parse(value))) return value;
    const date = new Date(value);
    return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
  };
  const field = (key: "maxAmountNear" | "periodAmountNear" | "perTransactionCapNear" | "limitedCalls" | "expiresAt", label: string, hint: string) => (
    <div className="space-y-2">
      <Label htmlFor={`policy-${key}`}>{label}</Label>
      <Input id={`policy-${key}`} value={key === "expiresAt" ? localDate(form[key]) : form[key]} type={key === "expiresAt" ? "datetime-local" : "text"}
        inputMode={key === "limitedCalls" ? "numeric" : key === "expiresAt" ? undefined : "decimal"}
        onChange={event => update(key, key === "expiresAt" && event.target.value ? new Date(event.target.value).toISOString() : event.target.value)} aria-invalid={Boolean(errors[key])} aria-describedby={`policy-${key}-help`} />
      <p id={`policy-${key}-help`} className={errors[key] ? "text-sm text-destructive" : "text-sm text-muted-foreground"}>{errors[key] || hint}</p>
    </div>
  );
  const periods = { hourly: "hour", daily: "24 hours", weekly: "7 days", monthly: "30 days" };
  return <Drawer direction={props.mobile ? "bottom" : "right"} open={props.open} dismissible={!locked} onOpenChange={open => { if (!open && !locked) props.onClose(); }}>
    <DrawerContent className="data-[vaul-drawer-direction=right]:sm:max-w-xl">
      <DrawerHeader className="relative pr-12">
        <DrawerTitle>{readOnly ? "Spending policy" : mode === "review" ? "Review spending policy" : "Set a spending policy"}</DrawerTitle>
        <DrawerDescription>{props.identity} · {CHAIN_NAME}{active ? " · Active" : status === "revoked" ? " · Revoked" : ""}</DrawerDescription>
        <Button className="absolute right-3 top-3" variant="ghost" size="icon" aria-label="Close policy drawer" disabled={locked} onClick={props.onClose}><X className="size-4" /></Button>
      </DrawerHeader>
      <div className="flex-1 min-h-0 overflow-y-auto px-5 py-3 space-y-6">
        {props.recovery && !active && <div role="status" className="rounded-lg border p-3 text-sm">An earlier activation needs a status check. Its original rules are restored below. Continue to recover it without allocating the budget twice.</div>}
        {(issues.length > 0 || hasFormErrors(errors) || props.error) && <div ref={errorRef} tabIndex={-1} role="alert" className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm space-y-2">
          <p className="font-medium">{props.error ? "Activation needs attention" : "Resolve these points before continuing"}</p>
          <ul className="list-disc pl-5">{[...issues, ...Object.entries(errors).filter(([key]) => key !== "allowedTargetsWarning").map(([, value]) => value!), ...(props.error ? [props.error] : [])].map((issue, i) => <li key={i}>{issue}</li>)}</ul>
        </div>}
        {mode === "ai" && <div className="space-y-4">
          <div className="rounded-xl border bg-muted/30 p-4 space-y-3">
            <div className="flex items-center gap-2 font-medium"><Sparkles className="size-4" /> Describe the rules. Review before signing.</div>
            <p className="text-sm text-muted-foreground">Start with this editable demo policy, or write your own. Include a total budget and any recurring allowance, per-payment cap, recipients, transaction count, or expiry.</p>
            <Label htmlFor="ai-policy">Spending instructions</Label>
            <Textarea id="ai-policy" className="min-h-56 text-sm leading-relaxed" value={prompt} maxLength={6000} disabled={locked} onChange={event => { setPrompt(event.target.value); setForm({ ...form, policyPrompt: event.target.value }); setIssues([]); }} />
            <p className="text-xs text-muted-foreground">The example recipients are demo accounts. Replace them with the accounts you want to pay.</p>
          </div>
          <Button variant="outline" className="w-full" disabled={locked || props.recovery} onClick={() => { setIssues([]); setMode("manual"); }}>Configure manually</Button>
          <p className="text-sm text-muted-foreground">AI proposes settings; your reviewed limits determine the on-chain permission. Categories and receipt instructions are not on-chain payment restrictions.</p>
        </div>}
        {mode === "manual" && <fieldset disabled={locked || props.recovery} className="space-y-5">
          <Button variant="outline" className="w-full" onClick={() => { setIssues([]); setMode("ai"); }}>Write policy with AI</Button>
          {field("maxAmountNear", `Total budget (${TOKEN_SYMBOL})`, `The total amount reserved for this ${agent ? "agent" : "employee"}. ${props.balance === null ? "Treasury balance is loading." : `${props.balance} ${TOKEN_SYMBOL} available to delegate.`}`)}
          <div className="space-y-2"><Label htmlFor="policy-period">Recurring allowance</Label>
            <select id="policy-period" className="w-full rounded-md border bg-background p-2" value={form.period} onChange={event => update("period", event.target.value)} aria-describedby="policy-period-help">
              <option value="none">{agent ? "No extra recurring limit" : "No recurring allowance"}</option><option value="hourly">Every hour</option><option value="daily">Every 24 hours</option><option value="weekly">Every 7 days</option><option value="monthly">Every 30 days</option>
            </select><p id="policy-period-help" className="text-sm text-muted-foreground">Starts at activation. Each period resets its allowance; the total budget never resets.</p></div>
          {form.period !== "none" && field("periodAmountNear", `Allowance per period (${TOKEN_SYMBOL})`, "Must fit within the total budget.")}
          {field("perTransactionCapNear", `Maximum per payment (${TOKEN_SYMBOL})`, agent ? "Optional. Leave empty to keep your employer's cap." : "Optional. Each payment must fit within the remaining budget and recurring allowance.")}
          <div className="space-y-2"><Label htmlFor="policy-recipients">Permitted recipient accounts</Label><Textarea id="policy-recipients" value={form.allowedTargets} onChange={event => update("allowedTargets", event.target.value)} placeholder="vendor.testnet, supplier.testnet" aria-invalid={Boolean(errors.allowedTargets)} aria-describedby="policy-recipients-help" /><p id="policy-recipients-help" className="text-sm text-muted-foreground">{errors.allowedTargets || (agent ? "Leave empty to follow your employer's recipient rules, or enter a narrower list." : "Separate accounts with commas or new lines. Leaving this empty permits any recipient.")}</p></div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.limitedCallsEnabled} onChange={event => update("limitedCallsEnabled", event.target.checked)} /> Limit total number of payments</label>
          {form.limitedCallsEnabled && field("limitedCalls", "Maximum payment count", "Applies over the entire lifetime of this permission.")}
          {field("expiresAt", "Expiration (your local time)", agent ? "Optional. Leave empty to keep your employer's end date." : "Optional. No payments are allowed after this time.")}
        </fieldset>}
        {mode === "review" && <div className="space-y-5">
          <h3 ref={reviewRef} tabIndex={-1} className="font-semibold outline-none">{active ? "Current spending rules" : "Review the spending rules"}</h3>
          <p className="text-sm font-medium break-words">{props.identity}</p>
          <dl className="space-y-3 rounded-xl border bg-muted/20 p-4 text-sm">
            <div className="flex justify-between gap-4"><dt>Total budget</dt><dd className="font-semibold">{form.maxAmountNear} {TOKEN_SYMBOL}</dd></div>
            {form.period !== "none" && <div className="flex justify-between gap-4"><dt>Every {periods[form.period]}</dt><dd className="font-semibold">{form.periodAmountNear} {TOKEN_SYMBOL}</dd></div>}
            {form.perTransactionCapNear && <div className="flex justify-between gap-4"><dt>Per payment</dt><dd className="font-semibold">Up to {form.perTransactionCapNear} {TOKEN_SYMBOL}</dd></div>}
            <div><dt className="text-muted-foreground">Can pay</dt><dd className="mt-1 break-words font-medium">{splitAddresses(form.allowedTargets).join(", ") || "Any recipient"}</dd></div>
            {form.limitedCallsEnabled && <div className="flex justify-between gap-4"><dt>Number of payments</dt><dd>Up to {form.limitedCalls}</dd></div>}
            <div className="flex justify-between gap-4"><dt>Access ends</dt><dd className="text-right">{form.expiresAt ? new Date(form.expiresAt).toLocaleString() : "When you revoke it"}</dd></div>
          </dl>
          <p className="text-sm text-muted-foreground">{agent ? "This budget comes from your allowance. Your employer’s spending rules also apply." : "This is the total they can spend. Spending reduces it, even when a weekly or monthly allowance resets."}</p>
          {!agent && <p className="text-sm text-muted-foreground">The employee can assign part of this budget to agents. You can revoke their unused access anytime.</p>}
          <details className="text-sm"><summary className="cursor-pointer text-muted-foreground">More details</summary><div className="mt-3 space-y-2 text-muted-foreground">
            <p className="break-all">NEAR account: {props.account}</p>
            {form.period !== "none" && <p>Allowances reset in fixed periods starting at activation, within the total budget.</p>}
            {!form.perTransactionCapNear && <p>Each payment can use the remaining budget, within any recurring allowance.</p>}
            <p>Expense categories and receipt instructions are guidance. The spending limits and recipient accounts above are enforced by the treasury.</p>
            {form.policyPrompt && <p className="whitespace-pre-wrap">Original instructions: {form.policyPrompt}</p>}
          </div></details>
          {warnings.length > 0 && <div className="rounded-lg border border-border bg-muted/20 p-3 text-sm"><p className="font-medium">Check before signing</p><ul className="list-disc pl-5">{warnings.map((warning, i) => <li key={i}>{warning}</li>)}</ul></div>}
          {!readOnly && <label className="flex items-start gap-3 text-sm"><input className="mt-1" type="checkbox" checked={acknowledged} disabled={locked} onChange={event => setAcknowledged(event.target.checked)} />I have reviewed these limits and recipient accounts.</label>}
          {!readOnly && !props.recovery && <Button variant="outline" className="w-full" disabled={locked} onClick={() => { setAcknowledged(false); setMode("manual"); }}>Edit settings manually</Button>}
        </div>}
        {confirmRevoke && <div role="alert" className="rounded-lg border border-destructive/40 p-4 space-y-3 text-sm"><p>Revoke access for {props.identity}? Future payments and agent access under this permission will stop. Completed payments remain unchanged.</p><div className="flex gap-2"><Button variant="outline" disabled={busy} onClick={() => setConfirmRevoke(false)}>Keep access</Button><Button variant="destructive" disabled={busy} onClick={props.onRevoke}>Confirm revocation</Button></div></div>}
      </div>
      <DrawerFooter className="border-t">
        {busy && <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{props.stage}</p>}
        {active ? <Button variant="destructive" disabled={locked} onClick={() => setConfirmRevoke(true)}>Revoke access</Button> : status === "pending_config" ?
          mode === "review" ? <Button disabled={locked || !acknowledged} onClick={() => { const next = validateCaveatForm(form, props.recovery ? null : props.balance, Date.now(), props.recovery); if (hasFormErrors(next)) { showErrors(next); return; } props.onActivate(); }}>{busy && <LoaderCircleIcon className="mr-2 size-4 animate-spin" />}{props.recovery ? "Check and recover activation" : `Sign & activate on ${CHAIN_NAME}`}</Button> :
          <Button disabled={locked || (mode === "ai" && !prompt.trim())} onClick={mode === "ai" ? reviewAI : reviewManual}>{parsing ? <><LoaderCircleIcon className="mr-2 size-4 animate-spin" />Reviewing policy…</> : "Review policy"}</Button> : null}
      </DrawerFooter>
    </DrawerContent>
  </Drawer>;
}
