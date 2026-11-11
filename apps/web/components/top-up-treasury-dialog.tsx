"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { CheckIcon, ChevronDownIcon, CopyIcon, ExternalLinkIcon, Loader2, PlusIcon } from "lucide-react";
import { FAUCET_USDC, MOCK_USDC_ACCOUNT_ID, TOKEN_SYMBOL } from "@/lib/chain";
import { parseTreasuryReference } from "@allocard/delegation-sdk";

const AuroraIntentWidget = dynamic(() => import("./aurora-intent-widget"), {
  ssr: false,
  loading: () => <div role="status" className="flex min-h-64 items-center justify-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />Loading funding options…</div>,
});

export interface TopUpTreasuryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  treasuryAddress?: string | null;
  adminAddress?: string | null;
  currentBalance?: string;
  onDirectTopUp?: () => Promise<void>;
  isToppingUp?: boolean;
}

export function TopUpTreasuryDialog({ open, onOpenChange, treasuryAddress, adminAddress, currentBalance, onDirectTopUp, isToppingUp = false }: TopUpTreasuryDialogProps) {
  const [copied, setCopied] = useState(false);
  let contractId = "";
  let companyId: string | undefined;
  if (treasuryAddress) {
    try {
      const parsed = parseTreasuryReference(treasuryAddress);
      contractId = parsed.contractId;
      companyId = parsed.companyId;
    } catch { contractId = treasuryAddress; }
  }
  const destinationAddress = contractId || adminAddress || "";
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(destinationAddress);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { setCopied(false); }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90dvh] gap-5 overflow-y-auto rounded-2xl p-4 sm:max-w-[504px] sm:p-6">
        <DialogHeader className="gap-1 pr-6">
          <DialogTitle className="text-xl font-semibold tracking-tight">Add funds</DialogTitle>
          <DialogDescription className="text-xs leading-relaxed">Choose how to fund your treasury.</DialogDescription>
        </DialogHeader>
        <Tabs defaultValue="crosschain" className="min-w-0 w-full gap-4">
          <TabsList className="grid h-10 w-full grid-cols-2 p-1">
            <TabsTrigger value="crosschain" className="min-w-0 text-xs">Aurora Intents</TabsTrigger>
            <TabsTrigger value="direct" className="min-w-0 text-xs">Faucet</TabsTrigger>
          </TabsList>
          <TabsContent value="crosschain" className="min-w-0 mt-0">
            {MOCK_USDC_ACCOUNT_ID && <p className="mb-3 text-xs leading-relaxed text-muted-foreground">This demo runs on NEAR testnet, so Aurora Intents cannot fund your treasury. Use the Faucet tab to add demo funds.</p>}
            {destinationAddress ? <AuroraIntentWidget destinationNearAddress={destinationAddress} /> : <p role="status" className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">Activate your treasury to add funds.</p>}
          </TabsContent>
          <TabsContent value="direct" className="mt-0 space-y-5">
            <div className="rounded-xl border border-border/70 p-5">
              <div className="flex items-baseline justify-between gap-3"><p className="text-sm font-medium">{MOCK_USDC_ACCOUNT_ID ? "Test USDC faucet" : "Wallet deposit"}</p><span className="text-xs text-muted-foreground">Testnet</span></div>
              <p className="my-4 text-3xl font-medium tracking-tight tabular-nums">{MOCK_USDC_ACCOUNT_ID ? Number(FAUCET_USDC).toLocaleString() : "1.7"} <span className="text-sm text-muted-foreground">{TOKEN_SYMBOL}</span></p>
              <p className="mb-4 text-xs leading-relaxed text-muted-foreground">{MOCK_USDC_ACCOUNT_ID ? "Adds test USDC directly to your company treasury." : "From your connected wallet. Includes storage and gas allocation."}</p>
              <Button className="h-11 w-full gap-2 rounded-lg" onClick={onDirectTopUp} disabled={!onDirectTopUp || isToppingUp}>
                {isToppingUp ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <PlusIcon className="size-4" aria-hidden="true" />}
                {isToppingUp ? "Adding funds…" : MOCK_USDC_ACCOUNT_ID ? `Claim ${Number(FAUCET_USDC).toLocaleString()} USDC` : `Add 1.7 ${TOKEN_SYMBOL}`}
              </Button>
            </div>
            {!MOCK_USDC_ACCOUNT_ID && <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
              <span className="text-muted-foreground">Need test tokens?</span>
              <Button variant="link" size="sm" className="h-auto p-0 text-xs" asChild><a href="https://near-faucet.io" target="_blank" rel="noopener noreferrer">Get test {TOKEN_SYMBOL}<ExternalLinkIcon className="size-3" aria-hidden="true" /></a></Button>
            </div>}
          </TabsContent>
        </Tabs>
        {destinationAddress && <details className="group min-w-0 border-t border-border/60 pt-3 text-xs">
          <summary className="flex cursor-pointer list-none items-center justify-between rounded-sm text-muted-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-details-marker]:hidden">Treasury details<ChevronDownIcon className="size-3.5 transition-transform group-open:rotate-180" aria-hidden="true" /></summary>
          <dl className="mt-3 space-y-3 rounded-lg bg-muted/40 p-3">
            <div className="flex items-center justify-between gap-3"><dt className="text-muted-foreground">Network</dt><dd>NEAR Testnet</dd></div>
            {currentBalance !== undefined && <div className="flex flex-wrap items-center justify-between gap-2"><dt className="text-muted-foreground">Balance</dt><dd className="break-all tabular-nums">{currentBalance} {TOKEN_SYMBOL}</dd></div>}
            <div><dt className="text-muted-foreground">Destination</dt><dd className="mt-1 flex min-w-0 items-center gap-2"><span className="min-w-0 flex-1 break-all font-mono text-[11px]">{destinationAddress}</span><Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={handleCopy} aria-label={copied ? "Address copied" : "Copy destination address"}>{copied ? <CheckIcon className="size-3.5" /> : <CopyIcon className="size-3.5" />}</Button></dd></div>
            {companyId && <div><dt className="text-muted-foreground">Company reference</dt><dd className="mt-1 break-all font-mono text-[11px]">{companyId}</dd></div>}
          </dl>
        </details>}
      </DialogContent>
    </Dialog>
  );
}
