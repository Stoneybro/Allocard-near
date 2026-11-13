"use client";

import { Fragment, useMemo, useState } from "react";
import styles from "./delegation-cards-view.module.css";
import { BotIcon, PlusIcon, NetworkIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { DelegationResearchActivity } from "@/components/purchasing-research-panel";
import { ADAPTER_NAME, agentDisplayName } from "@/lib/agent-adapter/shared";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { EmailTooltipLabel } from "@/components/email-tooltip-label";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { formatWalletAddress } from "@/lib/wallet";
import { TOKEN_SYMBOL } from "@/lib/chain";
import type { CSSProperties, ReactNode } from "react";
import type { DelegationCanvasCompany, DelegationCanvasEmployee, DelegationCanvasAgent, DelegationCanvasDelegation } from "@/components/dashboard-flow-canvas";

export interface DelegationCardsViewProps {
  loading?: boolean;
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


export function DelegationCardsView({ loading = false, company, employees, agents = [], delegations: allDelegations, onViewModeChange, headerAction, onConfigureDelegation, onRevokeDelegation, onRemoveDelegation, onAddEmployee, onAddAgent }: DelegationCardsViewProps) {
  const delegations = useMemo(() => allDelegations.filter(delegation => delegation.status !== "revoked"), [allDelegations]);
  const [isIssueDialogOpen, setIsIssueDialogOpen] = useState(false);
  const employeeById = new Map(employees.map(employee => [employee.id, employee]));
  const agentById = new Map(agents.map(agent => [agent.id, agent]));
  const assignedIds = new Set(delegations.filter(d => d.status !== "revoked").map(d => d.delegateeId));
  const availableEmployees = employees.filter(employee => !assignedIds.has(employee.id));
  const availableAgents = (onAddAgent ? agents : []).filter(agent => !agent.isPlaceholder && !assignedIds.has(agent.id));
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

  const [search, setSearch] = useState("");
  const [activityDelegation, setActivityDelegation] = useState<DelegationCanvasDelegation | null>(null);
  const [confirmation, setConfirmation] = useState<DelegationCanvasDelegation | null>(null);
  const query = search.trim().toLowerCase();
  const nameOf = (delegation: DelegationCanvasDelegation) => delegation.delegateeType === "user"
    ? employeeById.get(delegation.delegateeId ?? "")?.label ?? "Employee"
    : agentDisplayName(agentById.get(delegation.delegateeId ?? "")?.name ?? "AI agent");
  const fullEmailOf = (delegation: DelegationCanvasDelegation) => delegation.delegateeType === "user"
    ? employeeById.get(delegation.delegateeId ?? "")?.fullEmail ?? null
    : null;
  const issuerOf = (delegation: DelegationCanvasDelegation) => {
    if (delegation.delegatorType === "company") return "Company";
    const parent = delegations.find(item => item.id === delegation.parentDelegationId);
    if (parent) return nameOf(parent);
    return delegation.delegatorType === "user"
      ? employeeById.get(delegation.delegatorId)?.label ?? "Employee"
      : agentDisplayName(agentById.get(delegation.delegatorId)?.name ?? "AI agent");
  };
  const issuerFullEmailOf = (delegation: DelegationCanvasDelegation) => {
    if (delegation.delegatorType === "company") return null;
    const parent = delegations.find(item => item.id === delegation.parentDelegationId);
    if (parent) return fullEmailOf(parent);
    return delegation.delegatorType === "user"
      ? employeeById.get(delegation.delegatorId)?.fullEmail ?? null
      : null;
  };
  function matchesBranch(delegation: DelegationCanvasDelegation, path = new Set<string>()): boolean {
    if (path.has(delegation.id)) return false;
    const next = new Set(path).add(delegation.id);
    return `${nameOf(delegation)} ${fullEmailOf(delegation) ?? ""} ${issuerOf(delegation)} ${issuerFullEmailOf(delegation) ?? ""}`.toLowerCase().includes(query)
      || (children.get(delegation.id) ?? []).some(child => matchesBranch(child, next));
  }
  const visibleRoots = roots.filter(root => !query || matchesBranch(root));

  function renderAvailableEmployeeRow(emp: DelegationCanvasEmployee) {
    return (
      <div
        key={emp.id}
        className="flex items-center justify-between rounded-lg border border-border/80 bg-card p-3 shadow-2xs hover:border-primary/50 transition-colors"
      >
        <div className="flex items-center gap-3 min-w-0">
          <Avatar className="size-8">
            <AvatarFallback className="text-xs font-semibold bg-muted">
              {emp.label.slice(0, 2).toUpperCase()}
            </AvatarFallback>
          </Avatar>
          <div className="min-w-0">
            <p className="text-xs font-semibold text-foreground truncate">
              <EmailTooltipLabel
                label={emp.label}
                fullEmail={emp.fullEmail}
                className="block truncate"
              />
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
    );
  }

  function renderDelegation(delegation: DelegationCanvasDelegation, path: Set<string>, depth = 0): ReactNode {
    if (path.has(delegation.id)) return null;
    const nextPath = new Set(path).add(delegation.id);
    const title = nameOf(delegation);
    const titleFullEmail = fullEmailOf(delegation);
    const descendants = children.get(delegation.id) ?? [];
    const isExpanded = !collapsed.has(delegation.id) || Boolean(query);
    const isActive = delegation.status === "active";
    const isPending = delegation.status === "pending_config";
    const status = isActive ? "Active" : isPending ? "Needs setup" : delegation.status;
    const canManage = delegation.delegatorType === "company";
    const canRevoke = isActive && (canManage || (delegation.delegateeType === "agent" && Boolean(delegation.parentDelegationId)));
    const hasActions = (canManage && (onConfigureDelegation || (isPending && onRemoveDelegation))) || (canRevoke && onRevokeDelegation);
    const hasResearchActivity = delegation.delegateeType === "agent" && agentById.get(delegation.delegateeId ?? "")?.name === ADAPTER_NAME;
    const issuer = issuerOf(delegation);
    const issuerFullEmail = issuerFullEmailOf(delegation);
    return (
      <Fragment key={delegation.id}>
        <TableRow data-delegation-id={delegation.id} className={depth ? "bg-muted/25" : undefined}>
          <TableCell className="py-4 whitespace-normal">
            <div className={`flex min-w-0 items-center gap-2 ${styles.indent}`} style={{ "--depth": Math.min(depth, 4) } as CSSProperties}>
              {descendants.length > 0 && <Button variant="ghost" size="icon" className="size-8 shrink-0"
                aria-label={`${isExpanded ? "Collapse" : "Expand"} details for ${title}`}
                aria-expanded={isExpanded}
                onClick={() => setCollapsed(previous => { const next = new Set(previous); if (next.has(delegation.id)) next.delete(delegation.id); else next.add(delegation.id); return next; })}>
                <ChevronRightIcon className={`size-4 transition-transform ${isExpanded ? "rotate-90" : ""}`} />
              </Button>}
              <div className="min-w-0">
                <p className="break-words font-medium tracking-tight">{depth > 0 && <span aria-hidden="true" className="mr-1 text-muted-foreground">↳</span>}<EmailTooltipLabel label={title} fullEmail={titleFullEmail} /></p>
                <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">{delegation.delegateeType === "user" ? "Employee" : "Agent access"} · {status}{descendants.length > 0 && ` · ${descendants.length} redelegation${descendants.length === 1 ? "" : "s"}`}</p>
              </div>
            </div>
          </TableCell>
          <TableCell className="text-muted-foreground">
            <span className={styles.label}>Delegated by</span>
            <EmailTooltipLabel label={issuer} fullEmail={issuerFullEmail} />
          </TableCell>
          <TableCell className="text-right tabular-nums"><span className={styles.label}>Limit ({TOKEN_SYMBOL})</span>{delegation.allowance ?? "—"}</TableCell>
          <TableCell className="text-right font-medium tabular-nums"><span className={styles.label}>Remaining ({TOKEN_SYMBOL})</span>{isActive ? delegation.remainingNear ?? "—" : "—"}</TableCell>
          <TableCell className="text-right">
            {(hasActions || hasResearchActivity) ? <div className={styles.actions}>
              {hasResearchActivity && <Button variant="outline" size="sm" className="h-8 px-2 text-xs" aria-label={`View activity for ${title}, delegated by ${issuer}`} onClick={() => setActivityDelegation(delegation)}>View activity</Button>}
              {canManage && onConfigureDelegation && <Button variant="outline" size="sm" className="h-8 px-2 text-xs" aria-label={`${isPending ? "Configure" : "View rules for"} ${title}`} onClick={() => onConfigureDelegation(delegation.id)}>{isPending ? "Configure" : "View rules"}</Button>}
              {((canRevoke && onRevokeDelegation) || (canManage && isPending && onRemoveDelegation)) && <Button variant="outline" size="sm" className="h-8 border-border bg-muted/50 px-3 text-xs font-medium text-foreground shadow-xs hover:bg-muted" aria-label={`${isActive ? "Revoke" : "Remove"} delegation for ${title}`} onClick={() => setConfirmation(delegation)}>{isActive ? "Revoke" : "Remove"}</Button>}
            </div> : <span className="text-muted-foreground">—<span className="sr-only"> Managed by {issuer}</span></span>}
          </TableCell>
        </TableRow>
        {isExpanded && descendants.map(child => renderDelegation(child, nextPath, depth + 1))}
      </Fragment>
    );
  }

  return (
    <section aria-label="Delegations" className="min-w-0 space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-64">
          <SearchIcon className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
          <Input aria-label="Search delegations" placeholder="Search delegations…" value={search} onChange={event => setSearch(event.target.value)} className="h-9 pl-9" disabled={loading} />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {/* Quick Add delegation Dialog */}
          <Dialog open={isIssueDialogOpen} onOpenChange={setIsIssueDialogOpen}>
            <DialogTrigger asChild>
              <Button disabled={loading} size="sm" className="h-8 gap-1.5 text-xs font-medium">
                <PlusIcon className="size-3.5" />
                <span>Add delegation</span>
              </Button>
            </DialogTrigger>
            <DialogContent className="max-w-md">
              <DialogHeader>
                <DialogTitle>Create Spending Delegation</DialogTitle>
                <DialogDescription>
                  Select an employee to grant spending authority.
                </DialogDescription>
              </DialogHeader>

              {availableAgents.length > 0 ? (
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
                      availableEmployees.map(renderAvailableEmployeeRow)
                    )}
                  </TabsContent>

                  {/* Tab: Agents */}
                  <TabsContent value="agents" className="mt-4 space-y-2 max-h-[300px] overflow-y-auto">
                    {availableAgents.map((agent) => (
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
                              {agentDisplayName(agent.name)}
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
                    ))}
                  </TabsContent>
                </Tabs>
              ) : (
                <div className="mt-4 space-y-2 max-h-[300px] overflow-y-auto">
                  {availableEmployees.length === 0 ? (
                    <div className="rounded-lg border border-dashed border-border p-6 text-center text-xs text-muted-foreground">
                      No unassigned team members found. Invite new employees using the sidebar.
                    </div>
                  ) : (
                    availableEmployees.map(renderAvailableEmployeeRow)
                  )}
                </div>
              )}
            </DialogContent>
          </Dialog>

          {headerAction}
          <Button disabled={loading} variant="ghost" size="sm" onClick={() => onViewModeChange("canvas")} className="hidden md:inline-flex"><NetworkIcon className="size-3.5" />Canvas</Button>
        </div>
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        <Table aria-label={`Delegations from ${company.name}`} className={styles.table}>
          <TableHeader className="bg-muted/40">
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-[28%] pl-4 text-xs text-muted-foreground">Delegate</TableHead>
              <TableHead className="w-[18%] text-xs text-muted-foreground">Delegated by</TableHead>
              <TableHead className="w-[14%] text-right text-xs text-muted-foreground">Limit ({TOKEN_SYMBOL})</TableHead>
              <TableHead className="w-[16%] whitespace-normal text-right text-xs text-muted-foreground">Remaining ({TOKEN_SYMBOL})</TableHead>
              <TableHead className="w-[24%] pr-4 text-right text-xs text-muted-foreground">Actions</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? [0, 1, 2].map(row => <TableRow key={row} data-loading-row><TableCell className="p-4"><Skeleton className="h-5 w-28 max-w-full" /></TableCell><TableCell ><Skeleton className="h-5 w-20" /></TableCell><TableCell ><Skeleton className="h-5 w-12" /></TableCell><TableCell><Skeleton className="ml-auto h-5 w-12" /></TableCell><TableCell><Skeleton className="ml-auto h-8 w-16 max-w-full" /></TableCell></TableRow>)
              : visibleRoots.length ? visibleRoots.map(root => renderDelegation(root, new Set()))
              : null}
          </TableBody>
        </Table>
        {!loading && !visibleRoots.length && <div role="status" className="flex w-full flex-col items-center justify-center px-4 py-12 text-center"><p className="font-medium">{query ? "No matching delegations" : "No delegations yet"}</p><p className="mt-1 text-xs text-muted-foreground">{query ? "Try another name or clear your search." : "Add an employee or agent to set up spending authority."}</p></div>}
      </div>
      <Dialog open={Boolean(activityDelegation)} onOpenChange={open => { if (!open) setActivityDelegation(null); }}>
        <DialogContent className="max-h-[85dvh] overflow-y-auto sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle>Research activity</DialogTitle>
            <DialogDescription>{activityDelegation ? `${nameOf(activityDelegation)} · Delegated by ${issuerOf(activityDelegation)}. Research runs for this delegation.` : ""}</DialogDescription>
          </DialogHeader>
          {activityDelegation && <DelegationResearchActivity key={activityDelegation.id} companyId={company.id} delegationId={activityDelegation.id} />}
        </DialogContent>
      </Dialog>
      <AlertDialog open={Boolean(confirmation)} onOpenChange={open => { if (!open) setConfirmation(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmation?.status === "active" ? "Revoke" : "Remove"} delegation for {confirmation ? nameOf(confirmation) : ""}?</AlertDialogTitle>
            <AlertDialogDescription>{confirmation?.status === "active" ? confirmation.parentDelegationId ? "This revokes this delegation and its descendants. The issuing employee’s own delegation and other agent delegations remain unchanged." : "This revokes spending authority for this delegation and all its descendants." : "This discards the pending configuration. You can add a new delegation later."}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Cancel</AlertDialogCancel><AlertDialogAction onClick={() => { if (confirmation) { if (confirmation.status === "active") onRevokeDelegation?.(confirmation.id); else onRemoveDelegation?.(confirmation.id); } }}>{confirmation?.status === "active" ? "Revoke delegation" : "Remove delegation"}</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}
