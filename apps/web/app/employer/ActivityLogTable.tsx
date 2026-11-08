"use client";

import { useState } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { useAccountScope } from "@/hooks/use-account-queries";
import { withTimeout } from "@/lib/request-timeout";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Loader2, ExternalLink } from "lucide-react";
import { getActivityLog, type ActivityCursor } from "@/app/actions/activity";
import { getTxExplorerUrl, TOKEN_SYMBOL } from "@/lib/chain";

export function ActivityLogTable({ companyId }: { companyId: string }) {
  const { key, address } = useAccountScope();
  const [type, setType] = useState("all");
  const query = useInfiniteQuery({
    queryKey: [...key, "activity", companyId, type], enabled: !!address && !!companyId,
    initialPageParam: null as ActivityCursor | null,
    queryFn: ({ pageParam }) => withTimeout(getActivityLog(companyId, { cursor: pageParam, type }), "Activity took too long to load. Please retry."),
    getNextPageParam: page => page.nextCursor,
    refetchInterval: 30_000,
  });
  const log = query.data?.pages.flatMap(page => page.items) ?? [];
  const loading = query.isPending;
  if (query.error) return <div role="alert" className="p-6 text-sm text-destructive">
    {query.error.message} <button onClick={() => { void query.refetch(); }} className="underline">Try again</button>
  </div>;

  if (loading) {
    return (
      <div className="flex justify-center p-12">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }


  return (
    <div className="rounded-md border">
      <div className="flex items-center justify-between p-3 text-sm">
        <label>Activity type <select aria-label="Activity type" value={type} onChange={event => setType(event.target.value)} className="ml-2 rounded border p-1">
          {["all", "Direct Spend", "Procurement", "Reimbursement"].map(value => <option key={value} value={value}>{value}</option>)}
        </select></label>
        <button className="underline" onClick={() => { void query.refetch(); }}>Refresh</button>
      </div>
      {!log.length && <p className="p-6 text-sm text-muted-foreground">No matching activity.</p>}
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Date</TableHead>
            <TableHead>Actor</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Amount</TableHead>
            <TableHead>Purpose</TableHead>
            <TableHead>Status</TableHead>
            <TableHead>Tx</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {log.map((item) => (
            <TableRow key={item.id}>
              <TableCell className="whitespace-nowrap">
                {new Date(item.date).toLocaleDateString()}{" "}
                <span className="text-muted-foreground text-xs">
                  {new Date(item.date).toLocaleTimeString()}
                </span>
              </TableCell>
              <TableCell>{item.actor}</TableCell>
              <TableCell>
                <Badge variant="outline">{item.type}</Badge>
              </TableCell>
              <TableCell>{item.amountNear} {item.assetNetwork === "near:testnet" ? TOKEN_SYMBOL : "(legacy asset)"}</TableCell>
              <TableCell className="max-w-xs truncate" title={item.purpose}>
                {item.purpose}
              </TableCell>
              <TableCell>
                <Badge
                  variant={
                    item.status.includes("Flagged") || item.status === "Failed" || item.status === "Rejected"
                      ? "destructive"
                      : item.status.includes("Compliant") || item.status === "Approved" || item.status === "Executed"
                      ? "default"
                      : "secondary"
                  }
                  className={item.status.includes("Compliant") ? "bg-green-500/10 text-green-600 border-green-500/50 hover:bg-green-500/20" : ""}
                >
                  {item.status.length > 30 ? item.status.substring(0, 30) + "..." : item.status}
                </Badge>
              </TableCell>
              <TableCell>
                {item.txHash && item.assetNetwork === "near:testnet" ? (
                  <a
                    href={getTxExplorerUrl(item.txHash)}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-500 hover:text-blue-700"
                  >
                    <ExternalLink className="h-4 w-4" />
                  </a>
                ) : (
                  "-"
                )}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
      {query.hasNextPage && <button className="m-4 text-sm underline" disabled={query.isFetchingNextPage} onClick={() => { void query.fetchNextPage(); }}>{query.isFetchingNextPage ? "Loading…" : "Load more activity"}</button>}
    </div>
  );
}
