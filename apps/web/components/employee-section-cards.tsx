"use client";

import { WalletIcon } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent, CardDescription, CardHeader } from "@/components/ui/card";
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip";
import { TOKEN_SYMBOL } from "@/lib/chain";

export function EmployeeSectionCards({ loading = false, approvedLimitNear, redelegatedNear, remainingNear, spentNear = "0", reservationsSupported = false }: {
  loading?: boolean;
  reservationsSupported?: boolean;
  approvedLimitNear?: string;
  redelegatedNear?: string;
  remainingNear?: string;
  spentNear?: string;
}) {
  return (
    <TooltipProvider delayDuration={300}>
      <div className="grid min-w-0 grid-cols-1 gap-3 lg:gap-4 xl:grid-cols-2">
        <Card className="min-w-0 gap-5 rounded-2xl border-foreground/10 bg-foreground text-background shadow-sm [--card-spacing:--spacing(5)] sm:[--card-spacing:--spacing(6)]">
          <CardHeader>
            <CardDescription className="text-sm font-medium text-background/70">
              <Tooltip><TooltipTrigger asChild><button type="button" className="flex cursor-default items-center gap-2 rounded-sm text-left underline decoration-background/25 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-background/60"><WalletIcon className="size-4" aria-hidden="true" />Available for direct spending</button></TooltipTrigger><TooltipContent sideOffset={8}>Company funds available for direct payments under your spending permission.</TooltipContent></Tooltip>
            </CardDescription>
          </CardHeader>
          <CardContent aria-busy={loading}>
            {loading ? <Skeleton className="my-1 h-12 w-40 max-w-full bg-background/15" /> : <p className="break-words text-4xl font-medium tracking-tight tabular-nums sm:text-5xl">{remainingNear ?? "—"} <span className="text-sm font-medium tracking-normal text-background/55">{TOKEN_SYMBOL}</span></p>}
          </CardContent>
        </Card>
        <Card className="min-w-0 justify-center gap-0 rounded-2xl border-border/70 shadow-xs [--card-spacing:--spacing(4)] sm:[--card-spacing:--spacing(6)]">
          <CardContent className="px-0">
            <dl className="grid grid-cols-3 divide-x divide-border/70">
              {[
                { label: "Initial spending limit", value: approvedLimitNear, description: "Allowance granted by your employer before spending. Your available allowance is shown separately." },
                { label: "Spent", value: spentNear, description: "Business spending executed from your delegated allowance." },
                { label: "Delegated to agents", value: redelegatedNear, description: reservationsSupported ? "Unspent allowance reserved for agent use, excluded from direct spending. Revoking access releases the unused allocation." : "Agent limits share your allowance on this legacy treasury; they are not separate deposits." },
              ].map(({ label, value, description }) => <div key={label} className="flex min-w-0 flex-col px-3 sm:px-6">
                <dt className="min-h-8 flex-1 text-xs font-medium leading-4 text-muted-foreground sm:min-h-10 sm:text-sm sm:leading-5"><Tooltip><TooltipTrigger asChild><button type="button" className="cursor-default rounded-sm text-left underline decoration-muted-foreground/40 decoration-dotted underline-offset-4 outline-none focus-visible:ring-2 focus-visible:ring-ring">{label}</button></TooltipTrigger><TooltipContent sideOffset={8} className="max-w-64 text-pretty leading-relaxed">{description}</TooltipContent></Tooltip></dt>
                <dd className="mt-2 flex flex-wrap items-baseline gap-x-1.5 gap-y-1 break-words text-[1.75rem] font-medium leading-none tracking-[-0.035em] tabular-nums sm:mt-3 sm:text-4xl">{loading ? <Skeleton className="h-9 w-16 max-w-full" /> : <><span className="min-w-0 break-words">{value ?? "—"}</span><span className="text-[10px] font-normal leading-normal tracking-normal text-muted-foreground sm:text-xs"> {TOKEN_SYMBOL}</span></>}</dd>
              </div>)}
            </dl>
          </CardContent>
        </Card>
      </div>
    </TooltipProvider>
  );
}
