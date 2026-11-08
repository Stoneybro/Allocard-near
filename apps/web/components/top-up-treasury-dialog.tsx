"use client";

import React, { useState } from "react";
import dynamic from "next/dynamic";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  ArrowRightLeftIcon,
  CheckIcon,
  CopyIcon,
  ExternalLinkIcon,
  GlobeIcon,
  Loader2,
  SparklesIcon,
  WalletIcon,
} from "lucide-react";
import { TOKEN_SYMBOL } from "@/lib/chain";
import { parseTreasuryReference } from "@allocard/delegation-sdk";

const AuroraIntentWidget = dynamic(
  () => import("./aurora-intent-widget"),
  {
    ssr: false,
    loading: () => (
      <div className="flex flex-col items-center justify-center p-12 space-y-3 min-h-[380px] text-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        <p className="text-xs text-muted-foreground">Loading Aurora Intent Connect...</p>
      </div>
    ),
  }
);

export interface TopUpTreasuryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  treasuryAddress?: string | null;
  adminAddress?: string | null;
  currentBalance?: string;
  onDirectTopUp?: () => Promise<void>;
  isToppingUp?: boolean;
}

export function TopUpTreasuryDialog({
  open,
  onOpenChange,
  treasuryAddress,
  adminAddress,
  currentBalance,
  onDirectTopUp,
  isToppingUp = false,
}: TopUpTreasuryDialogProps) {
  const [copied, setCopied] = useState(false);

  // Parse contract ID and company ID from treasury reference
  let contractId = "";
  let companyId: string | undefined;

  if (treasuryAddress) {
    try {
      const parsed = parseTreasuryReference(treasuryAddress);
      contractId = parsed.contractId;
      companyId = parsed.companyId;
    } catch {
      contractId = treasuryAddress;
    }
  }

  // Destination address for Aurora solver settlement:
  // If we have an admin account on NEAR, solvers can send to either admin or contract account
  const destinationAddress = contractId || adminAddress || "";

  const handleCopy = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Fallback
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[520px] max-h-[92vh] overflow-y-auto p-6">
        <DialogHeader className="space-y-1.5 pb-2">
          <div className="flex items-center gap-2">
            <DialogTitle className="text-lg font-semibold tracking-tight">
              Top Up Treasury
            </DialogTitle>
            <Badge variant="outline" className="text-[10px] uppercase font-mono tracking-wider text-muted-foreground">
              NEAR Testnet
            </Badge>
          </div>
          <DialogDescription className="text-xs text-muted-foreground">
            Fund your corporate spending treasury from any wallet on any blockchain or directly on NEAR Testnet.
          </DialogDescription>
        </DialogHeader>

        {destinationAddress && (
          <div className="rounded-lg border border-border/70 bg-muted/30 p-2.5 text-xs flex items-center justify-between gap-2">
            <div className="flex flex-col min-w-0">
              <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                Destination Treasury
              </span>
              <span className="font-mono text-[11px] text-foreground truncate">
                {destinationAddress}
              </span>
            </div>
            <div className="flex items-center gap-1.5 shrink-0">
              {currentBalance !== undefined && (
                <span className="text-[11px] font-mono text-muted-foreground mr-1">
                  {currentBalance} {TOKEN_SYMBOL}
                </span>
              )}
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-muted-foreground hover:text-foreground cursor-pointer"
                onClick={() => handleCopy(destinationAddress)}
                title="Copy address"
              >
                {copied ? (
                  <CheckIcon className="h-3.5 w-3.5 text-emerald-500" />
                ) : (
                  <CopyIcon className="h-3.5 w-3.5" />
                )}
              </Button>
            </div>
          </div>
        )}

        <Tabs defaultValue="crosschain" className="w-full mt-2">
          <TabsList className="grid w-full grid-cols-2 h-9 p-0.5">
            <TabsTrigger value="crosschain" className="text-xs gap-1.5">
              <GlobeIcon className="h-3.5 w-3.5" />
              <span>Cross-Chain (Any Wallet)</span>
            </TabsTrigger>
            <TabsTrigger value="direct" className="text-xs gap-1.5">
              <WalletIcon className="h-3.5 w-3.5" />
              <span>Direct NEAR Testnet</span>
            </TabsTrigger>
          </TabsList>

          <TabsContent value="crosschain" className="mt-4 space-y-3">
            <div className="rounded-lg border border-primary/20 bg-primary/5 p-3 text-xs space-y-1">
              <div className="flex items-center gap-1.5 font-medium text-foreground">
                <SparklesIcon className="h-3.5 w-3.5 text-primary" />
                <span>Aurora Intent Connect</span>
              </div>
              <p className="text-[11px] text-muted-foreground leading-relaxed">
                Connect MetaMask, Phantom, Coinbase, or any wallet. Pay from <strong>Ethereum, Base, Solana, Arbitrum, Optimism, Polygon, or Bitcoin</strong>. Solvers handle bridging and swap execution directly to NEAR Testnet.
              </p>
            </div>

            {destinationAddress ? (
              <AuroraIntentWidget destinationNearAddress={destinationAddress} />
            ) : (
              <div className="text-center p-6 text-xs text-muted-foreground">
                Treasury address unavailable. Ensure your company account is deployed.
              </div>
            )}
          </TabsContent>

          <TabsContent value="direct" className="mt-4 space-y-4">
            <div className="space-y-3">
              <div className="rounded-lg border border-border p-3.5 space-y-2 bg-card">
                <div className="flex items-center justify-between">
                  <div className="space-y-0.5">
                    <h4 className="text-xs font-semibold text-foreground">
                      Connected Wallet Deposit
                    </h4>
                    <p className="text-[11px] text-muted-foreground">
                      Fund 1.7 {TOKEN_SYMBOL} from your active NEAR testnet wallet (allocates native balance, storage, and gas).
                    </p>
                  </div>
                </div>

                {onDirectTopUp && (
                  <Button
                    size="sm"
                    className="w-full text-xs gap-2 mt-2"
                    onClick={onDirectTopUp}
                    disabled={isToppingUp}
                  >
                    {isToppingUp ? (
                      <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    ) : (
                      <ArrowRightLeftIcon className="h-3.5 w-3.5" />
                    )}
                    <span>Deposit 1.7 {TOKEN_SYMBOL} from Wallet</span>
                  </Button>
                )}
              </div>

              <div className="rounded-lg border border-border p-3.5 space-y-2 bg-card">
                <div className="space-y-0.5">
                  <h4 className="text-xs font-semibold text-foreground">
                    NEAR Testnet Faucet
                  </h4>
                  <p className="text-[11px] text-muted-foreground">
                    Need testnet funds? Request free {TOKEN_SYMBOL} tokens from the official NEAR testnet faucet.
                  </p>
                </div>

                <Button
                  variant="outline"
                  size="sm"
                  className="w-full text-xs gap-1.5"
                  asChild
                >
                  <a
                    href="https://near-faucet.io"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    <span>Open NEAR Testnet Faucet</span>
                    <ExternalLinkIcon className="h-3 w-3" />
                  </a>
                </Button>
              </div>

              {companyId && (
                <div className="rounded-lg border border-border/60 bg-muted/20 p-3 space-y-1.5 text-[11px]">
                  <span className="font-semibold text-foreground">Company Reference ID:</span>
                  <div className="font-mono text-[10px] break-all bg-background p-1.5 rounded border border-border/50 text-muted-foreground">
                    {companyId}
                  </div>
                </div>
              )}
            </div>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}

