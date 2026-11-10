"use client";

import { useState } from "react";
import type { EmployeeDashboardState } from "@/app/actions/identity";
import { ADAPTER_NAME } from "@/lib/agent-adapter/shared";
import { formatTokenAmount } from "@allocard/delegation-sdk";
import { TOKEN_SYMBOL } from "@/lib/chain";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { PurchasingResearchPanel } from "@/components/purchasing-research-panel";
import { PlusIcon } from "lucide-react";

type Props = {
  companyId: string;
  agents: EmployeeDashboardState["agents"];
  delegations: EmployeeDashboardState["outboundDelegations"];
  canAdd: boolean;
  busy?: boolean;
  onSelectAgent: (id: string) => void;
  onConfigure: (id: string) => void;
  onRevoke: (id: string) => void;
};

function spendingLimit(row: Props["delegations"][number]) {
  const caveat = row.caveats.find(item => item.caveatType === "nativeTokenTransferAmount");
  const value = caveat?.caveatValue as { maxAmount?: string; amount?: string } | undefined;
  const amount = value?.maxAmount ?? value?.amount;
  return amount && /^\d+$/.test(amount) ? formatTokenAmount(amount, 24) : "—";
}

export function EmployeeAgentsWorkspace({ companyId, agents, delegations, canAdd, busy = false, onSelectAgent, onConfigure, onRevoke }: Props) {
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState<Props["delegations"][number] | null>(null);
  const [researchId, setResearchId] = useState<string | null>(null);
  const rows = delegations.filter(row => row.status !== "revoked");
  const available = agents.filter(agent => !rows.some(row => row.delegateeId === agent.id));
  const research = rows.find(row => row.id === researchId);
  const agentName = (id: string | null) => agents.find(agent => agent.id === id)?.name ?? "AI agent";

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="text-xs text-muted-foreground">Manage agents using your company allowance.</p>
      <Dialog open={adding} onOpenChange={setAdding}>
        <DialogTrigger asChild><Button size="sm" className="h-9 gap-2" disabled={!canAdd || busy}><PlusIcon className="size-4" />Add agent</Button></DialogTrigger>
        <DialogContent><DialogHeader><DialogTitle>Add agent</DialogTitle><DialogDescription>Choose an agent, then set its spending rules.</DialogDescription></DialogHeader>
          <div className="max-h-80 space-y-2 overflow-y-auto">
            {available.length ? available.map(agent => <div key={agent.id} className="flex items-center justify-between gap-3 rounded-lg border p-3"><p className="min-w-0 text-sm font-medium">{agent.name}</p><Button variant="outline" size="sm" onClick={() => { setAdding(false); onSelectAgent(agent.id); }}>Select</Button></div>) : <p className="py-6 text-center text-sm text-muted-foreground">All available agents have been added.</p>}
          </div>
        </DialogContent>
      </Dialog>
    </div>
    {!canAdd && <p className="text-xs text-muted-foreground">Your employer needs to activate your spending allowance before you can add agents.</p>}
    <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
      <Table className="table-fixed" aria-label="Your agent delegations">
        <TableHeader className="bg-muted/40"><TableRow>
          <TableHead className="w-[42%] pl-4 text-xs text-muted-foreground sm:w-[35%]">Agent</TableHead>
          <TableHead className="hidden w-[18%] text-right text-xs text-muted-foreground sm:table-cell">Limit ({TOKEN_SYMBOL})</TableHead>
          <TableHead className="w-[25%] whitespace-normal text-right text-xs text-muted-foreground sm:w-[18%]">Remaining ({TOKEN_SYMBOL})</TableHead>
          <TableHead className="w-[33%] pr-4 text-right text-xs text-muted-foreground sm:w-[29%]">Actions</TableHead>
        </TableRow></TableHeader>
        <TableBody>{rows.length ? rows.map(row => <TableRow key={row.id}>
          <TableCell className="whitespace-normal py-4 pl-4"><p className="break-words font-medium tracking-tight">{agentName(row.delegateeId)}</p><p className="mt-1 text-[11px] text-muted-foreground">{row.status === "pending_config" ? "Needs setup" : agentName(row.delegateeId) === ADAPTER_NAME ? "Research · No purchases" : "Agent delegation"}</p><p className="mt-1 text-[11px] text-muted-foreground sm:hidden">Limit: {spendingLimit(row)} {TOKEN_SYMBOL}</p></TableCell>
          <TableCell className="hidden text-right tabular-nums sm:table-cell">{spendingLimit(row)}</TableCell>
          <TableCell className="whitespace-normal break-words text-right font-medium tabular-nums">{row.status === "active" ? row.remainingNear ?? "—" : "—"}</TableCell>
          <TableCell><div className="flex flex-wrap justify-end gap-1.5">
            {row.status === "active" && agentName(row.delegateeId) === ADAPTER_NAME && <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => setResearchId(row.id)}>Research</Button>}
            <Button variant="outline" size="sm" className="h-8 px-2 text-xs" onClick={() => onConfigure(row.id)} disabled={busy}>{row.status === "active" ? "View rules" : "Configure"}</Button>
            {row.status === "active" && <Button variant="outline" size="sm" className="h-8 bg-muted/50 px-2 text-xs" disabled={busy} onClick={() => setRevoking(row)}>Revoke</Button>}
          </div></TableCell>
        </TableRow>) : <TableRow><TableCell colSpan={4} className="whitespace-normal px-4 py-10 text-center"><p className="text-sm font-medium">No agents yet</p><p className="mt-1 text-xs text-muted-foreground">Add an agent to configure its spending access.</p></TableCell></TableRow>}</TableBody>
      </Table>
    </div>
    {research && <PurchasingResearchPanel key={research.id} companyId={companyId} delegationId={research.id} adapterId={research.delegateeId ?? undefined} onConfigure={() => onConfigure(research.id)} />}
    <AlertDialog open={Boolean(revoking)} onOpenChange={open => { if (!open) setRevoking(null); }}><AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Revoke {revoking ? agentName(revoking.delegateeId) : "agent"}?</AlertDialogTitle><AlertDialogDescription>This removes spending access for this agent and its descendants. Your own allowance remains unchanged.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (revoking) onRevoke(revoking.id); }}>Revoke agent</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
  </div>;
}
