"use client";
import { useResearchVisible } from "@/components/employee-spending-workspace";

import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { useAccountScope } from "@/hooks/use-account-queries";
import { researchRequest } from "@/lib/agent-adapter/client";
import { RESEARCH_AGENT_NAME, terminal, type ResearchTask } from "@/lib/agent-adapter/shared";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { ResearchReport } from "@/components/research-report";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const statuses: Record<string, string> = {
  queued: "Queued", dispatching: "Starting", running: "Running", delivered: "Completed",
  failed: "Failed", cancelled: "Cancelled", expired: "Expired", needs_reconciliation: "Checking status",
};

function AgentTaskRow({ task, onView }: { task: ResearchTask; onView: (task: ResearchTask) => void }) {
  const visible = useResearchVisible();
  const { key } = useAccountScope();
  const client = useQueryClient();
  const status = useQuery({
    queryKey: [...key, "research-status", task.companyId, task.id],
    enabled: visible && !terminal(task.state),
    queryFn: async () => {
      const updated = await researchRequest<ResearchTask>("/api/agent-adapter", { action: "progress", task: { id: task.id, digest: task.digest } });
      if (terminal(updated.state)) void client.invalidateQueries({ queryKey: [...key, "research", task.companyId] });
      return updated;
    },
    refetchInterval: query => query.state.data && terminal(query.state.data.state) ? false : 5000,
    retry: false,
  });
  const current = terminal(task.state) ? task : status.data ?? task;
  const active = !terminal(current.state);

  return <TableRow>
    <TableCell className="whitespace-normal py-5 pl-4 align-top sm:pl-5">
      <p className="text-sm font-medium tracking-tight">{RESEARCH_AGENT_NAME}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">NEAR AI Market</p>
      <p className="mt-2 line-clamp-2 break-words text-xs leading-relaxed text-muted-foreground sm:hidden">{current.prompt}</p>
    </TableCell>
    <TableCell className="hidden whitespace-normal py-5 align-top sm:table-cell">
      <p className="line-clamp-2 break-words text-sm leading-relaxed" title={current.prompt}>{current.prompt}</p>
      <time dateTime={current.createdAt} className="mt-2 block text-[11px] text-muted-foreground">{new Date(current.createdAt).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" })}</time>
    </TableCell>
    <TableCell className="whitespace-normal py-5 align-top">
      <Badge variant="outline" className="h-auto min-h-6 whitespace-normal rounded-md px-2 py-1 text-[11px] font-normal">
        {active && <Loader2 className="size-3 shrink-0 animate-spin" aria-hidden="true" />}{statuses[current.state] ?? current.state}
      </Badge>
      {current.message && (!active || current.state === "needs_reconciliation") && current.state !== "delivered" && <p className="mt-2 break-words text-xs leading-relaxed text-muted-foreground">{current.message}</p>}
      {status.error && active && <div className="mt-2 space-y-1"><p role="alert" className="text-xs text-muted-foreground">Status unavailable.</p><Button variant="link" className="h-auto p-0 text-xs" onClick={() => void status.refetch()}>Retry status</Button></div>}
    </TableCell>
    <TableCell className="py-5 pr-4 text-right align-top sm:pr-5">
      {current.state === "delivered" && current.result ? <Button variant="outline" size="sm" className="h-8 px-3 text-xs" aria-label={`View result for ${current.prompt}`} onClick={() => onView(current)}>View</Button> : <span className="text-xs text-muted-foreground">—</span>}
    </TableCell>
  </TableRow>;
}

export function AgentTaskTable({ companyId, ready }: { companyId: string; ready: boolean }) {
  const visible = useResearchVisible();
  const { key } = useAccountScope();
  const [result, setResult] = useState<ResearchTask | null>(null);
  const tasks = useQuery({
    queryKey: [...key, "research", companyId],
    enabled: visible,
    queryFn: () => researchRequest<ResearchTask[]>(`/api/agent-adapter?companyId=${encodeURIComponent(companyId)}`),
    refetchInterval: query => query.state.data?.some(task => !terminal(task.state) && task.state !== "proposal") ? 10000 : false,
    retry: false,
  });
  const rows = tasks.data?.filter(task => task.state !== "proposal") ?? [];
  return <>
    {tasks.error && <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4 text-xs"><p>{tasks.error.message}</p><Button size="sm" variant="outline" onClick={() => void tasks.refetch()}>Retry tasks</Button></div>}
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <Table className="table-fixed" aria-label="Hired agent tasks">
        <TableHeader className="bg-muted/30"><TableRow>
          <TableHead className="w-[45%] pl-4 text-xs text-muted-foreground sm:w-[25%] sm:pl-5">Agent</TableHead>
          <TableHead className="hidden w-[40%] text-xs text-muted-foreground sm:table-cell">Task</TableHead>
          <TableHead className="w-[25%] text-xs text-muted-foreground sm:w-[18%]">Status</TableHead>
          <TableHead className="w-[30%] pr-4 text-right text-xs text-muted-foreground sm:w-[17%] sm:pr-5">Result</TableHead>
        </TableRow></TableHeader>
        <TableBody>
          {tasks.isPending ? [0, 1].map(index => <TableRow key={index}>{[0, 1, 2, 3].map(cell => <TableCell key={cell} className={`p-4 ${cell === 1 ? "hidden sm:table-cell" : ""}`}><Skeleton className="h-5 w-full" /></TableCell>)}</TableRow>) : rows.length ? rows.map(task => <AgentTaskRow key={task.id} task={task} onView={setResult} />) : !tasks.error && <TableRow><TableCell colSpan={4} className="whitespace-normal px-5 py-14 text-center">
            <p className="text-sm font-medium tracking-tight">{ready ? "Your next task starts here" : "Set up your first agent"}</p>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground">{ready ? "Add an agent, describe what you need and track the results here." : "Configure agent access once, then hire a research agent for each task."}</p>
          </TableCell></TableRow>}
        </TableBody>
      </Table>
    </div>
    <Dialog open={!!result} onOpenChange={open => { if (!open) setResult(null); }}>
      <DialogContent className="max-h-[90dvh] gap-5 overflow-y-auto rounded-2xl p-5 sm:max-w-3xl sm:p-7">
        <DialogHeader className="gap-2 pr-5"><DialogTitle className="text-xl tracking-tight">Research result</DialogTitle><DialogDescription className="text-xs leading-relaxed">{RESEARCH_AGENT_NAME} · Completed</DialogDescription></DialogHeader>
        <div className="rounded-xl border border-border/70 bg-muted/20 p-4"><p className="text-[11px] font-medium text-muted-foreground">Your task</p><p className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed">{result?.prompt}</p></div>
        {result?.result && <ResearchReport>{result.result}</ResearchReport>}
      </DialogContent>
    </Dialog>
  </>;
}
