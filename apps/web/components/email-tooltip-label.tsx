"use client";

import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

/** Displays an employee's shortened email and reveals the full address on hover. */
export function EmailTooltipLabel({
  label,
  fullEmail,
  className,
}: {
  label: string;
  fullEmail?: string | null;
  className?: string;
}) {
  if (!fullEmail) {
    return <span className={className}>{label}</span>;
  }

  return (
    <TooltipProvider delayDuration={250}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            className={cn("inline-block max-w-full align-bottom cursor-default", className)}
            data-full-email={fullEmail}
          >
            {label}
          </span>
        </TooltipTrigger>
        <TooltipContent side="top" className="font-mono text-xs">
          {fullEmail}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

