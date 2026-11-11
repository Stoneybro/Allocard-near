"use client";

import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { ArrowLeft, ArrowUpRight, Check, Loader2 } from "lucide-react";
import { useAccountScope } from "@/hooks/use-account-queries";
import { researchRequest } from "@/lib/agent-adapter/client";
import { RESEARCH_PROMPT, WORKER_HANDLE, type Candidate, type ResearchTask } from "@/lib/agent-adapter/shared";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";

type Props = {
  companyId: string;
  delegationId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onHired: (task: ResearchTask) => void;
};

export function AgentHireDialog({ companyId, delegationId, open, onOpenChange, onHired }: Props) {
  const { key } = useAccountScope();
  const [step, setStep] = useState<"task" | "market" | "review">("task");
  const [prompt, setPrompt] = useState(RESEARCH_PROMPT);
  const [search, setSearch] = useState("");
  const [requestId, setRequestId] = useState(() => crypto.randomUUID());
  const [selected, setSelected] = useState<Candidate | null>(null);
  const [proposal, setProposal] = useState<ResearchTask | null>(null);
  const discovery = useQuery({
    queryKey: [...key, "market-discovery", companyId, search],
    enabled: open && step === "market" && !!search,
    queryFn: () => researchRequest<{ agents: Candidate[] }>(`/api/agent-adapter?companyId=${encodeURIComponent(companyId)}&q=${encodeURIComponent(search)}`),
    staleTime: 60000,
    retry: false,
  });
  const prepare = useMutation({
    retry: false,
    mutationFn: () => researchRequest<ResearchTask>("/api/agent-adapter", { action: "prepare", task: { companyId, delegationId, prompt: prompt.trim(), requestId } }),
    onSuccess: task => { setProposal(task); setStep("review"); },
  });
  const confirm = useMutation({
    retry: false,
    mutationFn: (task: ResearchTask) => researchRequest<ResearchTask>("/api/agent-adapter", { action: "confirm", task: { id: task.id, digest: task.digest } }),
    onSuccess: task => {
      onHired(task);
      onOpenChange(false);
      setStep("task"); setProposal(null); setSelected(null); setRequestId(crypto.randomUUID());
      prepare.reset();
    },
  });
  const pending = prepare.isPending || confirm.isPending;
  const error = prepare.error || confirm.error;
  const labels = ["Task", "Agent", "Review"];
  const current = step === "task" ? 0 : step === "market" ? 1 : 2;

  return <Dialog open={open} onOpenChange={value => { if (!pending) onOpenChange(value); }}>
    <DialogContent className="max-h-[90dvh] gap-5 overflow-y-auto rounded-2xl p-5 sm:max-w-[600px] sm:p-6">
      <DialogHeader className="gap-2 pr-5">
        <DialogTitle className="text-xl tracking-tight">{step === "task" ? "What would you like to do?" : step === "market" ? "Choose your agent" : "Review your task"}</DialogTitle>
        <DialogDescription className="text-xs leading-relaxed">{step === "task" ? "Describe the outcome you need. Start with the research brief below or make it your own." : step === "market" ? "Explore marketplace agents and choose one for your task." : "Confirm the brief before your research agent starts."}</DialogDescription>
      </DialogHeader>
      <ol aria-label="Hiring progress" className="flex gap-5 border-b border-border/60 pb-4">
        {labels.map((label, index) => <li key={label} aria-current={index === current ? "step" : undefined} className={`flex items-center gap-2 text-xs ${index === current ? "font-medium text-foreground" : "text-muted-foreground"}`}>
          <span className={`flex size-5 items-center justify-center rounded-full border text-[10px] ${index <= current ? "border-foreground bg-foreground text-background" : "border-border"}`}>{index < current ? <Check className="size-3" aria-hidden="true" /> : index + 1}</span>{label}
        </li>)}
      </ol>
      {error && <Alert role="alert"><AlertDescription className="text-xs leading-relaxed">{error.message}</AlertDescription></Alert>}
      {step === "task" && <div className="space-y-3">
        <Label htmlFor="agent-task" className="text-xs font-medium">Your task</Label>
        <Textarea id="agent-task" value={prompt} rows={6} maxLength={3000} className="min-h-40 resize-y text-sm leading-relaxed" onChange={event => {
          setPrompt(event.target.value); setProposal(null); setRequestId(crypto.randomUUID()); prepare.reset(); confirm.reset();
        }} />
        <p className="text-xs leading-relaxed text-muted-foreground">Include your team size, budget and must-have features. The demo agent researches and compares options; it cannot make purchases.</p>
      </div>}
      {step === "market" && <div className="space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-lg font-semibold tracking-tight">NEAR AI Market</h3>
          <a href="https://market.near.ai" target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground">Visit market<ArrowUpRight className="size-3.5" aria-hidden="true" /></a>
        </div>
        <p className="rounded-lg border border-border/60 bg-muted/30 p-3 text-xs leading-relaxed text-muted-foreground">This demo runs on NEAR testnet. Only Purchasing Research agent v2 is available to try, with no treasury funds required. Other marketplace agents are available to browse.</p>
        {discovery.isPending && <div role="status" aria-label="Loading marketplace agents" className="space-y-3"><Skeleton className="h-28 w-full" /><Skeleton className="h-24 w-full" /></div>}
        {discovery.error && <div role="alert" className="space-y-3 rounded-lg border p-4"><p className="text-xs leading-relaxed">{discovery.error.message}</p><Button size="sm" variant="outline" onClick={() => void discovery.refetch()}>Retry marketplace</Button></div>}
        {discovery.data && <div className="space-y-3">
          {!discovery.data.agents.some(agent => agent.handle === WORKER_HANDLE) && <div role="status" className="space-y-2"><p className="text-xs leading-relaxed text-muted-foreground">The research agent’s listing is unavailable.</p><Button variant="outline" size="sm" disabled={discovery.isFetching} onClick={() => void discovery.refetch()}>Refresh marketplace</Button></div>}
          {discovery.data.agents.map(agent => {
            const supported = agent.handle === WORKER_HANDLE;
            return <article key={agent.id} className={`space-y-3 rounded-xl border p-4 ${supported ? "border-foreground/30 bg-muted/20" : "border-border/70"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2"><h4 className="text-sm font-medium tracking-tight">{agent.name}</h4>{supported && <Badge variant="outline" className="text-[10px]">Available in demo</Badge>}</div>
              <p className="text-xs leading-relaxed text-muted-foreground">{agent.description}</p>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <a href={agent.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4">Market listing<ArrowUpRight className="size-3" aria-hidden="true" /></a>
                <Button size="sm" variant={supported ? "default" : "outline"} className="h-8 px-4 text-xs" disabled={!supported || pending} aria-label={`Hire ${agent.name}`} onClick={() => {
                  setSelected(agent); confirm.reset();
                  if (proposal) setStep("review"); else prepare.mutate();
                }}>{supported && prepare.isPending ? <Loader2 className="size-3 animate-spin" aria-hidden="true" /> : null}{supported ? "Hire" : "Unavailable on testnet"}</Button>
              </div>
            </article>;
          })}
        </div>}
      </div>}
      {step === "review" && proposal && <div className="space-y-5">
        <div><p className="text-xs text-muted-foreground">Selected agent</p><p className="mt-1 text-base font-medium tracking-tight">{selected?.name}</p><p className="mt-1 text-xs text-muted-foreground">Listed on NEAR AI Market · Direct demo execution</p></div>
        <div className="rounded-xl border border-border/70 bg-muted/20 p-4"><p className="whitespace-pre-wrap break-words text-sm leading-relaxed">{proposal.prompt}</p></div>
        <dl className="space-y-3 text-xs"><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Treasury charge</dt><dd className="font-medium">None · Testnet demo</dd></div><div className="flex justify-between gap-3"><dt className="text-muted-foreground">Agent access</dt><dd className="font-medium">Research only</dd></div></dl>
        <p className="text-xs leading-relaxed text-muted-foreground">This runs the listed research agent through its demo connection. No paid marketplace hire or purchase is created.</p>
      </div>}
      <DialogFooter className="flex-row items-center justify-between border-t border-border/60 pt-4 sm:justify-between">
        {step === "task" ? <Button variant="ghost" disabled={pending} onClick={() => onOpenChange(false)}>Cancel</Button> : <Button variant="ghost" disabled={pending} onClick={() => { prepare.reset(); confirm.reset(); setStep(step === "review" ? "market" : "task"); }}><ArrowLeft className="size-3.5" aria-hidden="true" />Back</Button>}
        {step === "task" && <Button disabled={prompt.trim().length < 20} onClick={() => { setSearch(prompt.trim().slice(0, 180)); setStep("market"); }}>Find agents</Button>}
        {step === "review" && <Button disabled={!proposal || pending} onClick={() => proposal && confirm.mutate(proposal)}>{confirm.isPending && <Loader2 className="size-3.5 animate-spin" aria-hidden="true" />}{confirm.isPending ? "Starting research…" : "Confirm and start"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}
