"use client";

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { EmployeeDashboardState } from "@/app/actions/identity";
import { useAccountScope } from "@/hooks/use-account-queries";
import { ADAPTER_NAME } from "@/lib/agent-adapter/shared";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { AgentHireDialog } from "@/components/agent-hire-dialog";
import { AgentTaskTable } from "@/components/agent-task-table";
import { Loader2, PlusIcon } from "lucide-react";

type Props = {
  companyId: string;
  agents: EmployeeDashboardState["agents"];
  delegations: EmployeeDashboardState["outboundDelegations"];
  canAdd: boolean;
  busy?: boolean;
  settingUp?: boolean;
  onSelectAgent: (id: string) => void;
  onConfigure: (id: string) => void;
  onRevoke: (id: string) => void;
};

export function EmployeeAgentsWorkspace({ companyId, agents, delegations, canAdd, busy = false, settingUp = false, onSelectAgent, onConfigure, onRevoke }: Props) {
  const { key } = useAccountScope();
  const client = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [revoking, setRevoking] = useState(false);
  const agent = agents.find(item => item.name === ADAPTER_NAME && item.isActive);
  const permission = agent && delegations.find(row => row.delegateeId === agent.id && row.status !== "revoked");
  const ready = permission?.status === "active";

  return <div className="min-w-0 space-y-4">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <div><h2 className="text-base font-medium tracking-tight">Agent workspace</h2><p className="mt-1 text-xs leading-relaxed text-muted-foreground">{ready ? "Hire agents for tasks and follow their progress." : "Set up agent access to get started."}</p></div>
      <div className="flex flex-wrap items-center gap-2">
        {ready && <><Button variant="outline" size="sm" className="h-9 text-xs" disabled={busy} onClick={() => onConfigure(permission.id)}>View rules</Button><Button variant="outline" size="sm" className="h-9 bg-muted/30 text-xs" disabled={busy} onClick={() => setRevoking(true)}>Revoke access</Button></>}
        <Button size="sm" className="h-9 gap-2 px-4" disabled={!canAdd || busy || settingUp || !agent} onClick={() => {
          if (ready) setAdding(true);
          else if (permission) onConfigure(permission.id);
          else if (agent) onSelectAgent(agent.id);
        }}>{settingUp ? <Loader2 className="size-3.5 animate-spin" aria-hidden="true" /> : ready && <PlusIcon className="size-3.5" aria-hidden="true" />}{settingUp ? "Preparing setup…" : ready ? "Add agent" : "Set up agent"}</Button>
      </div>
    </div>
    {!canAdd && <p className="text-xs text-muted-foreground">Your employer needs to activate your spending allowance before you can set up an agent.</p>}
    {!agent && <p role="status" className="text-xs text-muted-foreground">The research agent is not configured for this workspace yet.</p>}
    <AgentTaskTable companyId={companyId} ready={ready} />
    {ready && <AgentHireDialog key={permission.id} companyId={companyId} delegationId={permission.id} open={adding} onOpenChange={setAdding} onHired={task => {
      client.setQueryData([...key, "research", companyId], (existing: typeof task[] | undefined) => [task, ...(existing ?? []).filter(row => row.id !== task.id)]);
      void client.invalidateQueries({ queryKey: [...key, "research", companyId] });
    }} />}
    <AlertDialog open={revoking && ready} onOpenChange={setRevoking}>
      <AlertDialogContent><AlertDialogHeader><AlertDialogTitle>Revoke agent access?</AlertDialogTitle><AlertDialogDescription>This blocks new tasks and queued tasks that have not started. A running task may still finish. Your own allowance and saved results remain available.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction disabled={busy} onClick={() => { if (permission) onRevoke(permission.id); }}>Revoke access</AlertDialogAction></AlertDialogFooter></AlertDialogContent>
    </AlertDialog>
  </div>;
}
