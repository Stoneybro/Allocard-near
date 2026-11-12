"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { PlusIcon, Loader2, WalletIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TOKEN_SYMBOL } from "@/lib/chain";
import { CardRefreshButton } from "./card-refresh-button";

export function SectionCards({
  loading = false,
  balanceLoading = false,
  employeeCount,
  smartAccountBalance,
  activeDelegationCount,
  delegatedNativeNearAllowance,
  unallocatedBalance,
  reservationsSupported,
  onTopUp,
  isToppingUp,
  onRefresh,
}: {
  loading?: boolean;
  balanceLoading?: boolean;
  employeeCount?: number;
  smartAccountBalance?: string;
  activeDelegationCount?: number;
  delegatedNativeNearAllowance?: string;
  unallocatedBalance?: string;
  reservationsSupported?: boolean;
  onTopUp?: () => void;
  isToppingUp?: boolean;
  onRefresh?: () => Promise<unknown>;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="grid min-w-0 grid-cols-1 gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)] lg:gap-4">
        <Card className="relative min-w-0 gap-5 rounded-2xl border-foreground/10 bg-foreground text-background shadow-sm [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]">
          <CardRefreshButton onRefresh={onRefresh} />
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2">
            <CardDescription className="flex items-center gap-2 text-sm font-medium text-background/70">
              <Tooltip>
                <TooltipTrigger asChild>
                  <button type="button" className="flex cursor-default items-center gap-2 rounded-sm text-left underline decoration-background/25 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-background/60 focus-visible:ring-offset-4 focus-visible:ring-offset-foreground">
                    <WalletIcon className="size-4" aria-hidden="true" />
                    Treasury Balance
                  </button>
                </TooltipTrigger>
                <TooltipContent sideOffset={8} className="max-w-64 text-pretty leading-relaxed">
                  Corporate treasury balance on NEAR Testnet, used to fund company spending.
                </TooltipContent>
              </Tooltip>
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-wrap items-center justify-between gap-x-6 gap-y-3">
            <div className="min-w-0 flex-1 basis-40" aria-live="polite" aria-busy={loading || balanceLoading}>
              {loading || balanceLoading ? (
                <Skeleton className="my-1 h-12 w-40 max-w-full bg-background/15" />
              ) : (
                <p className="break-words text-4xl font-medium tracking-tight tabular-nums sm:text-5xl">
                  {smartAccountBalance ?? "—"}{" "}
                  <span className="text-sm font-medium tracking-normal text-background/55">{TOKEN_SYMBOL}</span>
                </p>
              )}
              {unallocatedBalance !== undefined && <p className="mt-2 text-xs text-background/70">Available to delegate: {unallocatedBalance} {TOKEN_SYMBOL}</p>}
            </div>
            <Button
              className="h-11 flex-1 basis-28 gap-2 rounded-xl bg-background px-5 font-semibold text-foreground shadow-xs hover:bg-background/90 focus-visible:ring-background/50 sm:flex-none"
              onClick={onTopUp}
              disabled={!onTopUp || loading || isToppingUp}
              aria-haspopup="dialog"
            >
              {isToppingUp ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <PlusIcon className="size-4" aria-hidden="true" />}
              {isToppingUp ? "Adding funds…" : "Add funds"}
            </Button>
          </CardContent>
        </Card>

        <Card className="min-w-0 justify-center gap-0 rounded-2xl border-border/70 shadow-xs [--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
          <CardContent className="px-0">
            <dl className="grid grid-cols-3 items-stretch divide-x divide-border/70">
              {[
                { label: "Employees", value: employeeCount, description: "Total onboarded team members." },
                { label: "Active Delegations", value: activeDelegationCount, description: "Employees and AI agents with active spending allowances." },
                { label: `${reservationsSupported ? "Reserved" : "Delegated"} ${TOKEN_SYMBOL}`, value: delegatedNativeNearAllowance, description: reservationsSupported ? "Unspent treasury funds reserved for employee allowances. Agent budgets are included within their employee allowance." : `Total ${TOKEN_SYMBOL} budgeted through delegations; not a funded reservation on this legacy treasury.` },
              ].map(({ label, value, description }) => (
                <div key={label} className="flex min-w-0 flex-col px-3 sm:px-6">
                  <dt className="min-h-8 text-xs font-medium leading-4 text-muted-foreground sm:min-h-10 sm:text-sm sm:leading-5">
                    <Tooltip>
                      <TooltipTrigger asChild>
                        <button type="button" className="cursor-default rounded-sm text-left underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card">
                          {label}
                        </button>
                      </TooltipTrigger>
                      <TooltipContent sideOffset={8} className="max-w-64 text-pretty leading-relaxed">
                        {description}
                      </TooltipContent>
                    </Tooltip>
                  </dt>
                  <dd className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 break-words text-[1.75rem] font-medium leading-none tracking-[-0.035em] text-foreground tabular-nums sm:mt-3 sm:text-4xl">
                    {loading ? <Skeleton className="h-9 w-16 max-w-full" /> : <><span className="min-w-0 break-words">{value ?? "—"}</span>{label === `${reservationsSupported ? "Reserved" : "Delegated"} ${TOKEN_SYMBOL}` && <span className="text-[10px] font-normal leading-normal tracking-normal text-muted-foreground sm:text-xs"> {TOKEN_SYMBOL}</span>}</>}
                  </dd>
                </div>
              ))}
            </dl>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
