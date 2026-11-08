"use client";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAccountScope } from "@/hooks/use-account-queries";
import { Drawer, DrawerContent, DrawerDescription, DrawerHeader, DrawerTitle } from "@/components/ui/drawer";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { getTxExplorerUrl } from "@/lib/chain";
import { reimbursementEmployeeMessage, type ReimbursementProgram } from "@/lib/reimbursements/shared";
import type { ReceiptExtractionResult } from "@/lib/ai";

async function post<T>(url: string, body: unknown): Promise<T> {
  const response = await fetch(url, { method: "POST", credentials: "same-origin", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(90_000) });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? "Request failed. Retry the same receipt before creating another payment.");
  return result;
}
type Extraction = { extraction: ReceiptExtractionResult; quote: string; amountNear: string; expiresAt: string };
type Claim = { claimId?: string; state?: string; txHash?: string; aiApproved?: boolean; aiReasoning?: string };
export function ReimbursementDrawer({ isOpen, onOpenChange, companyId, employeeId, program, accountReady, onRefresh }: {
  isOpen: boolean; onOpenChange: (open: boolean) => void; companyId: string; employeeId: string; program: ReimbursementProgram; accountReady: boolean; onRefresh: () => Promise<void>;
}) {
  const { key } = useAccountScope();
  const client = useQueryClient();
  const storageKey = `allocard-claim:${companyId}:${employeeId}`;
  const [image, setImage] = useState<string | null>(null);
  const [purpose, setPurpose] = useState("");
  const [pending, setPending] = useState<{ scope: string; id: string } | null>(null);
  useEffect(() => {
    const id = sessionStorage.getItem(storageKey);
    // Restore only a request identifier, never receipt images or private keys.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (id) setPending({ scope: storageKey, id });
  }, [storageKey]);
  const extraction = useMutation({ mutationFn: () => post<Extraction>("/api/agents/reimbursement/extract", { receiptBase64: image }), retry: false,
    onSuccess: result => setPurpose(result.extraction.suggestedPurpose),
  });
  const claim = useMutation({ mutationFn: () => post<Claim>("/api/agents/reimbursement/claim", { companyId, employeeId, claimDescription: purpose, receiptBase64: image, quote: extraction.data?.quote }), retry: false,
    onSuccess: async result => {
      if (result.claimId && result.state === "pending") { setPending({ scope: storageKey, id: result.claimId }); sessionStorage.setItem(storageKey, result.claimId); }
      await client.invalidateQueries({ queryKey: key });
      await onRefresh();
    },
  });
  const claimId = pending?.scope === storageKey ? pending.id : null;
  const status = useQuery({ queryKey: [...key, "reimbursement", companyId, claimId], enabled: isOpen && !!claimId,
    queryFn: () => post<Claim>("/api/agents/reimbursement/status", { claimId }), retry: false,
    refetchInterval: query => query.state.data?.state && query.state.data.state !== "pending" ? false : 2500,
  });
  const result = status.data ?? claim.data;
  useEffect(() => {
    if (result?.state === "paid" || result?.state === "failed") {
      sessionStorage.removeItem(storageKey);
      void client.invalidateQueries({ queryKey: key });
    }
  }, [result?.state, storageKey, client, key]);
  const busy = extraction.isPending || claim.isPending;
  const canSubmit = program.status === "ready" && accountReady;
  return <Drawer open={isOpen} onOpenChange={onOpenChange}><DrawerContent className="max-h-[92dvh]">
    <div className="mx-auto w-full max-w-xl overflow-y-auto p-6">
      <DrawerHeader><DrawerTitle>Employee reimbursement</DrawerTitle><DrawerDescription>{reimbursementEmployeeMessage(program.status)}</DrawerDescription></DrawerHeader>
      <div className="flex flex-col gap-4">
        {result?.state === "paid" ? <p role="status" className="text-green-700">Your reimbursement was confirmed on NEAR.</p> : <>
          <Label htmlFor="claim-receipt">Receipt image (USD or NEAR)</Label>
          <Input id="claim-receipt" type="file" accept="image/jpeg,image/png,image/webp" disabled={busy || !canSubmit} onChange={event => {
            const file = event.target.files?.[0]; if (!file) return;
            if (file.size > 8_000_000) { event.target.value = ""; return; }
            const reader = new FileReader(); reader.onload = () => { setImage(String(reader.result)); extraction.reset(); claim.reset(); }; reader.readAsDataURL(file);
          }} />
          <Button disabled={!image || busy || !canSubmit} onClick={() => extraction.mutate()}>{extraction.isPending ? "Reading receipt and quoting…" : "Read receipt / refresh quote"}</Button>
          {extraction.data && <>
            <p className="text-sm">Receipt total: {extraction.data.extraction.totalAmount} {extraction.data.extraction.currency}. Payout: <strong>{extraction.data.amountNear} NEAR</strong>.</p>
            <p className="text-xs text-muted-foreground">Quote expires at {new Date(extraction.data.expiresAt).toLocaleTimeString()}. USD receipts use a current server-verified NEAR/USD rate.</p>
            <Label htmlFor="claim-purpose">Business purpose</Label><Textarea id="claim-purpose" value={purpose} onChange={event => setPurpose(event.target.value)} disabled={busy} />
            <Button disabled={busy || !purpose.trim() || !canSubmit} onClick={() => claim.mutate()}>{claim.isPending ? "Reviewing and processing…" : "Submit this reimbursement"}</Button>
          </>}
        </>}
        {result?.state === "pending" && <p role="status">Payment is awaiting confirmation. Status checks do not submit another payment. If this remains pending, retry the same receipt to reconcile it.</p>}
        {result?.state === "failed" && <p role="alert">The payment failed. Contact your administrator to review this claim before another payout.</p>}
        {result?.aiApproved === false && result.state !== "pending" && <p role="alert">{result.aiReasoning ?? "This claim was not approved."}</p>}
        {(claim.error || extraction.error || status.error) && <p role="alert" className="text-sm text-destructive">{claim.error?.message ?? extraction.error?.message ?? status.error?.message}</p>}
        {result?.txHash && <a className="text-sm underline" href={getTxExplorerUrl(result.txHash)} target="_blank" rel="noreferrer">View NEAR transaction</a>}
        {(result?.state === "paid" || result?.state === "failed") && <Button variant="outline" onClick={() => { setImage(null); setPurpose(""); setPending(null); sessionStorage.removeItem(storageKey); extraction.reset(); claim.reset(); }}>Start another claim</Button>}
        <Button variant="outline" onClick={() => { void onRefresh(); if (claimId) void status.refetch(); }}>Refresh status</Button>
      </div>
    </div>
  </DrawerContent></Drawer>;
}
