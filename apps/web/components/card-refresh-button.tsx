"use client";

import { useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";

/** Positioned outside document flow so refreshing cannot resize the balance card. */
export function CardRefreshButton({ onRefresh }: { onRefresh?: () => Promise<unknown> }) {
  const lock = useRef(false);
  const [refreshing, setRefreshing] = useState(false);
  if (!onRefresh) return null;
  return <button type="button" aria-label="Refresh dashboard balances" title="Refresh balances"
    aria-busy={refreshing} disabled={refreshing}
    className="absolute right-2 top-2 z-10 flex size-7 items-center justify-center rounded-md text-background/65 transition-colors hover:bg-background/10 hover:text-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-background/60 disabled:cursor-wait"
    onClick={async () => {
      if (lock.current) return;
      lock.current = true; setRefreshing(true);
      try { await onRefresh(); } catch { toast.error("Could not refresh balances. Please retry."); }
      finally { lock.current = false; setRefreshing(false); }
    }}><RefreshCw aria-hidden="true" className={`size-3.5 ${refreshing ? "animate-spin" : ""}`} /></button>;
}
