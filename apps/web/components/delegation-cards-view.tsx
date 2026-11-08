"use client";

import { useMemo, useState } from "react";
import { BotIcon, UserRoundIcon, PlusIcon, NetworkIcon, ChevronRightIcon, Building2Icon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { formatWalletAddress } from "@/lib/wallet";
import { TOKEN_SYMBOL } from "@/lib/chain";
import type { ReactNode } from "react";
import type { DelegationCanvasCompany, DelegationCanvasEmployee, DelegationCanvasAgent, DelegationCanvasDelegation } from "@/components/dashboard-flow-canvas";

export interface DelegationCardsViewProps {
  company: DelegationCanvasCompany;
  employees: DelegationCanvasEmployee[];
  agents?: DelegationCanvasAgent[];
  delegations: DelegationCanvasDelegation[];
  viewMode: "cards" | "canvas";
  onViewModeChange: (mode: "cards" | "canvas") => void;
  headerAction?: ReactNode;
  onConfigureDelegation?: (delegationId: string) => void;
  onRevokeDelegation?: (delegationId: string) => void;
  onRemoveDelegation?: (delegationId: string) => void;
  onAddEmployee?: (employeeId: string) => void;
  onAddAgent?: (agentId: string) => void;
}


export function DelegationCardsView({ company, employees, agents = [], delegations, onViewModeChange, headerAction, onConfigureDelegation, onRevokeDelegation, onRemoveDelegation, onAddEmployee, onAddAgent }: DelegationCardsViewProps) {
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);
  const employeeById = new Map(employees.map(employee => [employee.id, employee]));
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  const assignedIds = new Set(delegations.filter(d => d.status !== "revoked").map(d => d.delegateeId));
  const availableEmployees = employees.filter(employee => !assignedIds.has(employee.id));
  const availableAgents = agents.filter(agent => !agent.isPlaceholder && !assignedIds.has(agent.id));
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const { roots, children } = useMemo(() => {
    const ids = new Set(delegations.map(d => d.id));
    const roots: DelegationCanvasDelegation[] = [];
    const children = new Map<string, DelegationCanvasDelegation[]>();
    for (const delegation of delegations) {
      if (delegation.parentDelegationId && ids.has(delegation.parentDelegationId)) {
        const siblings = children.get(delegation.parentDelegationId) ?? [];
        siblings.push(delegation);
        children.set(delegation.parentDelegationId, siblings);
      } else roots.push(delegation);
    }
    return { roots, children };
  }, [delegations]);

  function renderDelegation(delegation: DelegationCanvasDelegation, path: Set<string>): ReactNode {
    if (path.has(delegation.id)) return null;
    const nextPath = new Set(path).add(delegation.id);
    const employee = delegation.delegateeId ? employeeById.get(delegation.delegateeId) : undefined;
    const agent = delegation.delegateeId ? agentById.get(delegation.delegateeId) : undefined;
    const isEmployee = delegation.delegateeType === "user";
    const title = isEmployee ? employee?.label ?? "Employee" : agent?.name ?? "AI agent";
    const descendants = children.get(delegation.id) ?? [];
    const isCollapsed = collapsed.has(delegation.id);
    const isActive = delegation.status === "active";
    const isPending = delegation.status === "pending_config";
    const canManage = delegation.delegatorType === "company";
    const Icon = isEmployee ? UserRoundIcon : BotIcon;
    return (
      <li key={delegation.id} className="min-w-0">
        <div className="group flex flex-col gap-3 border-b border-border/60 py-4 sm:flex-row sm:items-center sm:gap-6">
          <div className="flex min-w-0 flex-1 items-center gap-3">
            {descendants.length > 0 ? (
              <button type="button" aria-label={`${isCollapsed ? "Expand" : "Collapse"} delegations for ${title}`} aria-expanded={!isCollapsed} onClick={() => setCollapsed(previous => {
                const next = new Set(previous);
                if (next.has(delegation.id)) next.delete(delegation.id); else next.add(delegation.id);
                return next;
              })} className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/60 hover:bg-muted focus-visible:outline-2 focus-visible:outline-ring">
                <ChevronRightIcon className={`size-4 transition-transform ${isCollapsed ? "" : "rotate-90"}`} />
              </button>
            ) : <span className="flex size-9 shrink-0 items-center justify-center rounded-md bg-muted/60 text-muted-foreground"><Icon className="size-4" /></span>}
            <div className="min-w-0">
              <p className="break-words text-sm font-medium">{title}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{isEmployee ? "Employee" : "AI agent"}{descendants.length > 0 && ` · ${descendants.length} delegation${descendants.length === 1 ? "" : "s"}`}</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 pl-12 sm:justify-end sm:pl-0">
            <div className="min-w-24 sm:text-right">
              <p className="text-sm font-medium tabular-nums">{isActive ? `${delegation.remainingNear ?? "—"} ${TOKEN_SYMBOL}` : "—"}</p>
              <p className="mt-0.5 text-xs text-muted-foreground">{isActive ? `remaining${delegation.allowance ? ` of ${delegation.allowance}` : ""}` : isPending ? "Set a spending limit" : "Spending disabled"}</p>
            </div>
            <Badge variant="outline" className={`font-normal ${isActive ? "border-emerald-600/20 text-emerald-700 dark:text-emerald-400" : "text-muted-foreground"}`}>{isActive ? "Active" : isPending ? "Needs setup" : "Revoked"}</Badge>
            {canManage && <div className="flex items-center gap-1">
              {delegation.status !== "revoked" && onConfigureDelegation && <Button variant={isPending ? "outline" : "ghost"} size="sm" onClick={() => onConfigureDelegation(delegation.id)} aria-label={`${isPending ? "Configure" : "View rules for"} ${title}`}>{isPending ? "Configure" : "Rules"}</Button>}
              {((isActive && onRevokeDelegation) || (isPending && onRemoveDelegation)) && <AlertDialog>
                <AlertDialogTrigger asChild><Button variant="ghost" size="sm" className="text-muted-foreground hover:text-destructive" aria-label={`${isActive ? "Revoke" : "Remove"} delegation for ${title}`}>{isActive ? "Revoke" : "Remove"}</Button></AlertDialogTrigger>
                <AlertDialogContent>
                  <AlertDialogHeader>
                    <AlertDialogTitle>{isActive ? "Revoke" : "Remove"} delegation for {title}?</AlertDialogTitle>
                    <AlertDialogDescription>{isActive ? "This revokes spending authority. Delegations beneath this permission will also lose spending authority." : "This discards the pending configuration. You can add a new delegation later."}</AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => isActive ? onRevokeDelegation?.(delegation.id) : onRemoveDelegation?.(delegation.id)}>{isActive ? "Revoke delegation" : "Remove delegation"}</AlertDialogAction></AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>}
            </div>}
          </div>
        </div>
        {descendants.length > 0 && !isCollapsed && <ul aria-label={`Delegated by ${title}`} className="ml-4 border-l border-border pl-3 sm:ml-4 sm:pl-6">{descendants.map(child => renderDelegation(child, nextPath))}</ul>}
      </li>
    );
  }

  return (
    <section aria-label="Delegations" className="min-w-0 space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div><h3 className="text-lg font-semibold tracking-tight">Delegations</h3><p className="mt-1 text-sm text-muted-foreground">Follow spending authority from your treasury to your team and agents.</p></div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Add delegation Dialog */}
          <Dialog open={isIssueDialogOpen} onOpenChange={setIsIssueDialogOpen}>
            <DialogTrigger asChild>
              <Button size="sm" className="h-8 gap-1.5 text-xs font-medium">
                <PlusIcon className="size-3.5" />
                <span>Add delegation</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Add a delegation</DialogTitle>
                <DialogDescription>
                  Select a team member or AI agent to grant spending authority directly from the company treasury.
                </DialogDescription>
              </DialogHeader>

              <Tabs defaultValue="employees" className="mt-2 w-full">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="employees" className="text-xs">
                    Team Members ({availableEmployees.length})
                  </TabsTrigger>
                  <TabsTrigger value="agents" className="text-xs">
                    AI Agents ({availableAgents.length})
                  </TabsTrigger>
                </TabsList>

                {/* Tab: Employees */}
                <TabsContent value="employees" className="mt-4 space-y-2 max-h-[300px] overflow-y-auto">
                  {availableEmployees.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                      No unassigned team members found. Invite new employees using the sidebar.
                    </div>
                  ) : (
                    availableEmployees.map((emp) => (
                      <div
                        key={emp.id}
                        className="flex items-center justify-between rounded-lg border border-border/80 bg-card p-3 shadow-2xs hover:border-primary/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Avatar className="size-8">
                            <AvatarFallback className="text-xs font-semibold bg-muted">
                              {emp.label.slice(0, 2)}
                            </AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">
                              {emp.label}
                            </p>
                            <p className="text-[11px] font-mono text-muted-foreground truncate">
                              {emp.smartAccountAddress
                                ? formatWalletAddress(emp.smartAccountAddress)
                                : "Account pending"}
                            </p>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setIsIssueDialogOpen(false);
                            onAddEmployee?.(emp.id);
                          }}
                        >
                          Select
                        </Button>
                      </div>
                    ))
                  )}
                </TabsContent>

                {/* Tab: Agents */}
                <TabsContent value="agents" className="mt-4 space-y-2 max-h-[300px] overflow-y-auto">
                  {availableAgents.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                      No unassigned AI agents available.
                    </div>
                  ) : (
                    availableAgents.map((agent) => (
                      <div
                        key={agent.id}
                        className="flex items-center justify-between rounded-lg border border-border/80 bg-card p-3 shadow-2xs hover:border-primary/50 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <div className="flex size-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <BotIcon className="size-4" />
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-semibold text-foreground truncate">
                              {agent.name}
                            </p>
                            <p className="text-[11px] font-mono text-muted-foreground truncate">
                              {agent.smartAccountAddress
                                ? formatWalletAddress(agent.smartAccountAddress)
                                : "Signer configured"}
                            </p>
                          </div>
                        </div>

                        <Button
                          size="sm"
                          variant="outline"
                          className="h-7 text-xs"
                          onClick={() => {
                            setIsIssueDialogOpen(false);
                            onAddAgent?.(agent.id);
                          }}
                        >
                          Select
                        </Button>
                      </div>
                    ))
                  )}
                </TabsContent>
              </Tabs>
            </DialogContent>
          </Dialog>

          {headerAction}
          <Button variant="ghost" size="sm" onClick={() => onViewModeChange("canvas")} className="hidden md:inline-flex"><NetworkIcon className="size-3.5" />Canvas</Button>
        </div>
      </div>
      <div className="border-y border-border py-5">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-muted"><Building2Icon className="size-5 text-muted-foreground" /></span>
            <div className="min-w-0"><p className="break-words text-sm font-semibold">{company.name}</p><p className="mt-0.5 text-xs text-muted-foreground">Company treasury · Source of spending authority</p></div>
          </div>
          <div className="pl-13 sm:pl-0 sm:text-right"><p className="text-lg font-semibold tabular-nums">{company.ethBalance ?? "—"} <span className="text-xs font-normal text-muted-foreground">{TOKEN_SYMBOL}</span></p><p className="text-xs text-muted-foreground">Treasury balance</p></div>
        </div>
        <p className="mt-4 text-xs text-muted-foreground">Delegated limits share this treasury. Funds stay here until spent.</p>
      </div>
      {roots.length > 0 ? <ul aria-label={`Delegations from ${company.name}`} className="ml-4 border-l border-border pl-3 sm:pl-6">{roots.map(root => renderDelegation(root, new Set()))}</ul> : <div className="py-10 text-center"><p className="text-sm font-medium">No delegations yet</p><p className="mx-auto mt-1 max-w-sm text-sm text-muted-foreground">Add an employee or agent, then set the limits for their spending authority.</p></div>}
    </section>
  );
}
