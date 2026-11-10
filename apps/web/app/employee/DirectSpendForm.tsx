"use client";
import { isUnsubmittedPayment } from "@/lib/pending-payment";

import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { useSettlementRefresh, useAccountScope } from "@/hooks/use-account-queries";
import type { Execution } from "@allocard/delegation-sdk";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent } from "@/components/ui/card";
import { parseUserOpError } from "@/lib/error-parser";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import { isNativeNearAccount, formatWalletAddress } from "@/lib/wallet";
import { getTxExplorerUrl, TOKEN_SYMBOL } from "@/lib/chain";
import { formatTokenAmount, parseTokenAmount } from "@allocard/delegation-sdk";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

type Props = {
  loading?: boolean;
  companyId: string;
  delegationId: string;
  pendingStorageKey?: string;
  remainingBalanceNear: string;
  onExecute: (details: { toAddress: string; amountNear: string; purpose?: string; isFlagged?: boolean }) => Promise<string>;
};

export function DirectSpendForm({ loading = false, companyId, delegationId, pendingStorageKey, remainingBalanceNear, onExecute }: Props) {
  const [step, setStep] = useState<"input" | "done">("input");

  const [toAddress, setToAddress] = useState("");
  const [amountNear, setAmountNear] = useState("");

  const [txHash, setTxHash] = useState<string | null>(null);
  const [lastExecutedAmount, setLastExecutedAmount] = useState<string>("");
  const [lastExecutedRecipient, setLastExecutedRecipient] = useState<string>("");
  const [error, setError] = useState<string | null>(null);

  const [isConfirmOpen, setIsConfirmOpen] = useState(false);
  const execution = useMutation({ mutationFn: onExecute, retry: false });
  const isExecuting = execution.isPending;
  const refreshAfterSettlement = useSettlementRefresh();
  const { key } = useAccountScope();
  const pendingStatus = useQuery({
    queryKey: [...key, "pending-payment", companyId, pendingStorageKey],
    enabled: !loading && !!pendingStorageKey && !isExecuting,
    queryFn: async () => {
      const saved = JSON.parse(localStorage.getItem(pendingStorageKey!) || "null");
      if (!saved?.request || isUnsubmittedPayment(saved)) return null;
      const response = await fetch("/api/wallet/pending", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          companyId,
          requestId: saved.request.request_id,
          deadlineMs: saved.request.deadline_ms,
        }),
        signal: AbortSignal.timeout(20_000),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "Could not check payment status");
      return result as { execution: Execution | null; canDiscard: boolean };
    },
    refetchInterval: (query) =>
      query.state.data &&
      !query.state.data.canDiscard &&
      (!query.state.data.execution || query.state.data.execution.status === "Pending")
        ? 2500
        : false,
  });

  useEffect(() => {
    if (pendingStatus.data?.execution?.status === "Succeeded") {
      refreshAfterSettlement();
    }
  }, [pendingStatus.data?.execution?.status, refreshAfterSettlement]);

  const [hasPendingRequest, setHasPendingRequest] = useState(false);
  useEffect(() => {
    if (!pendingStorageKey) return;
    try {
      const saved = JSON.parse(localStorage.getItem(pendingStorageKey) || "null");
      if (saved?.request?.action) {
        // Restore browser-persisted payment intent after hydration.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setToAddress(saved.request.action.receiver);
        setAmountNear(formatTokenAmount(saved.request.action.amount, 24));
        setHasPendingRequest(!isUnsubmittedPayment(saved));
      }
    } catch {
      setError("Saved payment data could not be read. Check your account's execution history before starting another payment.");
    }
  }, [pendingStorageKey]);

  const validateInputs = (): boolean => {
    const trimmedTo = toAddress.trim();
    if (!trimmedTo || !amountNear) {
      setError("Please fill in recipient account and amount.");
      return false;
    }

    if (!isNativeNearAccount(trimmedTo)) {
      setError("Please enter a valid NEAR recipient account (e.g. vendor.testnet).");
      return false;
    }

    try {
      const amount = BigInt(parseTokenAmount(amountNear.trim(), 24));
      const remaining = BigInt(parseTokenAmount(remainingBalanceNear, 24));
      if (amount <= BigInt(0) || (!hasPendingRequest && amount > remaining)) {
        throw new Error(`Enter an amount within your available ${remainingBalanceNear} NEAR`);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Invalid amount");
      return false;
    }

    setError(null);
    return true;
  };

  const handleStartExecute = () => {
    if (validateInputs()) {
      setIsConfirmOpen(true);
    }
  };

  const handleExecute = async () => {
    setError(null);
    const recipient = toAddress.trim();
    const amount = amountNear.trim();

    try {
      const hash = await execution.mutateAsync({
        toAddress: recipient,
        amountNear: amount,
      });
      setTxHash(hash);
      setLastExecutedAmount(amount);
      setLastExecutedRecipient(recipient);
      setHasPendingRequest(false);
      setStep("done");
      setIsConfirmOpen(false);
      void pendingStatus.refetch();
      toast.success("Expense Executed Successfully", {
        description: `${amount} ${TOKEN_SYMBOL} sent to ${formatWalletAddress(recipient)} • NEAR Testnet`,
        action: {
          label: "View Explorer",
          onClick: () => window.open(getTxExplorerUrl(hash), "_blank"),
        },
      });
    } catch (err) {
      if (pendingStorageKey) {
        const saved = JSON.parse(localStorage.getItem(pendingStorageKey) || "null");
        setHasPendingRequest(!!saved && !isUnsubmittedPayment(saved));
      }
      void pendingStatus.refetch();
      console.error(err);
      const parsed = parseUserOpError(err);
      setError(parsed);
      toast.error("Expense Execution Failed", {
        description: parsed,
      });
      setIsConfirmOpen(false);
    }
  };

  return (
    <Card aria-label="Direct payment" className="w-full rounded-2xl border-border/70 bg-card shadow-xs">
      {pendingStatus.data?.execution && (
        <p role="status" className="px-6 pt-4 text-sm">
          Saved payment status: {pendingStatus.data.execution.status}. Retry the same payment to reconcile its history; status checks never sign transactions.
        </p>
      )}
      {pendingStatus.error && (
        <p role="alert" className="px-6 text-sm text-destructive">{pendingStatus.error.message}</p>
      )}
      <CardContent>
        {step === "input" && (
          <div className="space-y-4">
            {error && (
              <Alert className="border-destructive/60 bg-destructive/10 text-destructive py-2.5">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle className="text-xs font-semibold">Validation Error</AlertTitle>
                <AlertDescription className="text-xs mt-0.5">{error}</AlertDescription>
              </Alert>
            )}

            {hasPendingRequest && (
              <p role="status" className="text-xs text-muted-foreground">
                A previous payment may still be processing. Check its status before sending a different payment; recovery keeps the original request identity.
              </p>
            )}


            <div className="space-y-2">
              <Label htmlFor="ds-to" className="text-xs font-medium">Recipient Account</Label>
              <Input
                id="ds-to"
                placeholder="vendor.testnet"
                value={toAddress}
                onChange={(e) => setToAddress(e.target.value)}
                className="h-11 text-sm"
                disabled={loading || isExecuting}
              />
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label htmlFor="ds-amount" className="text-xs font-medium">Amount ({TOKEN_SYMBOL})</Label>
                <div className="text-[11px] font-mono text-muted-foreground">
                  Available: {loading ? <Skeleton className="inline-block h-3 w-20 align-middle" /> : <>{remainingBalanceNear} {TOKEN_SYMBOL}</>}
                </div>
              </div>
              <Input
                id="ds-amount"
                type="text"
                inputMode="decimal"
                placeholder="0.00"
                value={amountNear}
                onChange={(e) => setAmountNear(e.target.value)}
                disabled={loading || isExecuting}
                className="h-11 text-sm"
              />
            </div>

            <p className="text-xs text-muted-foreground">Company spending limits and recipient rules apply.</p>

            <AlertDialog open={isConfirmOpen} onOpenChange={setIsConfirmOpen}>
              <Button
                onClick={handleStartExecute}
                disabled={loading || (!delegationId && !hasPendingRequest) || !toAddress || !amountNear || isExecuting}
                className="mt-2 h-11 w-full rounded-lg text-sm"
              >
                {isExecuting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                {isExecuting ? "Processing payment…" : "Review payment"}
              </Button>

              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>Confirm Direct Spend</AlertDialogTitle>
                  <AlertDialogDescription className="text-xs leading-relaxed">
                    You are authorizing a payout of <strong className="text-foreground">{amountNear} {TOKEN_SYMBOL}</strong> to{" "}
                    <strong className="break-all font-mono text-[11px] text-foreground">{toAddress}</strong> on NEAR Testnet.
                    <br /><br />
                    This transaction executes directly from the company&apos;s delegated balance and is irreversible. On-chain caveats and per-transaction limits apply.
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel disabled={loading || isExecuting}>Cancel</AlertDialogCancel>
                  <AlertDialogAction
                    onClick={handleExecute}
                    disabled={loading || isExecuting}
                    className="text-xs"
                  >
                    {isExecuting ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                    Confirm & Execute
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        )}

        {step === "done" && (
          <div className="flex flex-col items-center justify-center py-6 space-y-5 text-center">
            <div className="h-12 w-12 rounded-full bg-muted border border-border flex items-center justify-center">
              <CheckCircle2 className="h-6 w-6 text-foreground" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-sm font-semibold text-foreground">Spend Settled on NEAR</h2>
              <p className="text-xs text-muted-foreground">
                Successfully sent <strong className="text-foreground font-mono">{lastExecutedAmount} {TOKEN_SYMBOL}</strong> to{" "}
                <strong className="text-foreground font-mono">{formatWalletAddress(lastExecutedRecipient)}</strong>.
              </p>
            </div>

            {txHash && (
              <div className="w-full rounded-lg border border-border/80 bg-muted/30 p-3 flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Transaction</span>
                <a
                  href={getTxExplorerUrl(txHash)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-primary hover:underline"
                >
                  {txHash.slice(0, 8)}...{txHash.slice(-6)}
                  <ExternalLink className="size-3" />
                </a>
              </div>
            )}

            <Button
              variant="outline"
              className="w-full text-xs"
              onClick={() => {
                setToAddress("");
                setAmountNear("");
                setTxHash(null);
                setStep("input");
              }}
            >
              New Spend
            </Button>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
