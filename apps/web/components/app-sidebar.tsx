"use client";

import { Skeleton } from "@/components/ui/skeleton";
import * as React from "react";
import { useRouter } from "next/navigation";
import { useAuth } from "@/components/AuthProvider";
import type { WorkspaceOption } from "@/app/actions/identity";
import {
  BotIcon,
  CheckIcon,
  CopyIcon,
  GripVertical,
  LogOutIcon,
  MoreVerticalIcon,
  PlusIcon,
  RefreshCwIcon,
  UserPlusIcon,
  UserRoundIcon,
  WalletIcon,
} from "lucide-react";

import { Alert, AlertDescription } from "@/components/ui/alert";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from "@/components/ui/dropdown-menu";

import {
  HoverCard,
  HoverCardTrigger,
  HoverCardContent,
} from "@/components/ui/hover-card";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenu,
} from "@/components/ui/sidebar";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type SidebarEmployee = {
  id: string;
  label: string;
  detail: string;
};

export type SidebarAgent = {
  id: string;
  name: string;
  detail: string;
  isPlaceholder?: boolean;
  status?: "active" | "ready" | "coming_soon";
};

// ---------------------------------------------------------------------------
// Placeholder agents
// ---------------------------------------------------------------------------

const PLACEHOLDER_AGENTS: SidebarAgent[] = [
  {
    id: "placeholder-travel-concierge",
    name: "Travel Concierge",
    detail: "Autonomous corporate flight & hotel booking",
    isPlaceholder: true,
    status: "coming_soon",
  },
  {
    id: "placeholder-saas-subscription",
    name: "SaaS Subscription Agent",
    detail: "License seats & API quota renewals",
    isPlaceholder: true,
    status: "coming_soon",
  },
  {
    id: "placeholder-expense-reviewer",
    name: "Expense Reviewer",
    detail: "Flags out-of-policy spend automatically",
    isPlaceholder: true,
    status: "coming_soon",
  },
  {
    id: "placeholder-budget-guard",
    name: "Budget Guard",
    detail: "Enforces period budgets across delegations",
    isPlaceholder: true,
    status: "coming_soon",
  },
  {
    id: "placeholder-approval-bot",
    name: "Approval Bot",
    detail: "Routes high-value spend to the right approver",
    isPlaceholder: true,
    status: "coming_soon",
  },
];

// ---------------------------------------------------------------------------
// Smart account address — copyable, monochrome
// ---------------------------------------------------------------------------

function SmartAccountAddress({ label, fullAddress, role }: { label: string; fullAddress?: string | null; role?: "employer" | "employee" }) {
  const [copied, setCopied] = React.useState(false);
  const isPending = label === "Treasury pending";

  const handleCopy = async () => {
    if (isPending) return;
    const textToCopy = fullAddress || label;
    await navigator.clipboard.writeText(textToCopy);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button variant="ghost" size="sm" className="w-full justify-start text-muted-foreground">
          <WalletIcon className="size-4" />
          {role === "employee" ? "Wallet details" : "Treasury details"}
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{role === "employee" ? "Your wallet" : "Company treasury"}</DialogTitle>
          <DialogDescription>{isPending ? "Activate your account to enable funding and delegations." : role === "employee" ? "Your NEAR Testnet wallet address." : "Internal treasury reference on NEAR Testnet. Fund this treasury using the dashboard funding action; this reference is not a transfer address."}</DialogDescription>
        </DialogHeader>
        {!isPending && <>
          <Label htmlFor="treasury-address">{role === "employee" ? "NEAR account" : "Treasury reference"}</Label>
          <Input id="treasury-address" readOnly value={fullAddress || label} className="font-mono text-xs" />
          <Button variant="outline" onClick={() => { void handleCopy().catch(() => setCopied(false)); }}>
            {copied ? <CheckIcon /> : <CopyIcon />}{copied ? "Copied" : "Copy address"}
          </Button>
        </>}
      </DialogContent>
    </Dialog>
  );
}

// Add employee dialog — shadcn modal for email invitation
// ---------------------------------------------------------------------------

function AddEmployeeDialog({
  onInviteEmployeeByEmail,
  pendingEmployees,
}: {
  onInviteEmployeeByEmail?: (email: string) => Promise<void>;
  pendingEmployees?: { id: string; email: string; createdAt: string }[];
}) {
  const [open, setOpen] = React.useState(false);
  const [email, setEmail] = React.useState("");
  const [isSubmitting, setIsSubmitting] = React.useState(false);

  const handleSubmit = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!email.trim() || !onInviteEmployeeByEmail) return;
    setIsSubmitting(true);
    try {
      await onInviteEmployeeByEmail(email.trim());
      setEmail("");
      setOpen(false);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          type="button"
          size="sm"
          className="h-8 w-full text-xs font-semibold gap-1.5 justify-center px-3 shadow-xs bg-primary text-primary-foreground hover:bg-primary/90 transition-all cursor-pointer"
        >
          <UserPlusIcon className="size-3.5" />
          <span>Add Employee</span>
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>Add an Employee</DialogTitle>
          <DialogDescription>
            Add their work email, then share the Allocard link. They can accept access after signing in with that email.
          </DialogDescription>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="invite-employee-email">Employee email</Label>
            <Input
              id="invite-employee-email"
              type="email"
              placeholder="colleague@company.com"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={isSubmitting}
            />
            <p className="text-xs text-muted-foreground">
              They can accept after signing in with this email address. Their NEAR wallet is created automatically.
            </p>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="submit"
              disabled={isSubmitting || !email.trim() || !onInviteEmployeeByEmail}
            >
              {isSubmitting ? "Adding..." : "Invite employee"}
            </Button>
          </div>

          {pendingEmployees && pendingEmployees.length > 0 && (
            <div className="border-t border-border pt-3 mt-1">
              <p className="text-xs font-medium text-foreground mb-1.5">
                Awaiting sign in ({pendingEmployees.length})
              </p>
              <div className="max-h-28 overflow-y-auto space-y-1 pr-1">
                {pendingEmployees.map((p) => (
                  <div
                    key={p.id}
                    className="flex items-center justify-between text-xs px-2.5 py-1.5 rounded-md bg-muted/60 text-muted-foreground"
                  >
                    <span className="truncate max-w-[240px] font-mono text-[11px] text-foreground">
                      {p.email}
                    </span>
                    <Badge variant="outline" className="text-[9px] h-4 text-amber-600 border-amber-300">
                      Pending
                    </Badge>
                  </div>
                ))}
              </div>
            </div>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ---------------------------------------------------------------------------
// Canvas section — employees + AI agents, each capped & scrollable
// ---------------------------------------------------------------------------

function CanvasSection({
  agents,
  employees,
  pendingEmployees,
  onAddEmployee,
  onInviteEmployeeByEmail,
  onRefreshEmployees,
  employeesRefreshing,
  onSelectAgent,
  role,
}: {
  agents: SidebarAgent[];
  employees: SidebarEmployee[];
  pendingEmployees?: { id: string; email: string; createdAt: string }[];
  onAddEmployee?: (employeeId: string) => void;
  onInviteEmployeeByEmail?: (email: string) => Promise<void>;
  onRefreshEmployees?: () => void;
  employeesRefreshing?: boolean;
  onSelectAgent?: (agentId: string) => void;
  role?: "employer" | "employee";
}) {
  const displayAgents = agents.length > 0 ? agents : PLACEHOLDER_AGENTS;
  const hasLiveAgents = displayAgents.some((a) => !a.isPlaceholder);

  return (
    <SidebarGroup className="flex flex-col gap-0 pt-2">
      <SidebarGroupContent className="flex flex-col gap-4 px-2">
        {/* ── Employees — employer only ──────────────────────────────── */}
        {role !== "employee" && (
          <div className="flex flex-col gap-2.5">
            {/* Prominent Add Employee action in the sidebar - placed above Employees text */}
            {onInviteEmployeeByEmail && (
              <AddEmployeeDialog
                onInviteEmployeeByEmail={onInviteEmployeeByEmail}
                pendingEmployees={pendingEmployees}
              />
            )}

            {/* Sub-label row */}
            <div className="flex items-center justify-between gap-2 px-1">
              <span className="flex items-center gap-1.5 text-[11px] font-semibold text-foreground/80">
                <UserRoundIcon className="size-3.5 text-primary/80" />
                Employees
              </span>
              <div className="flex items-center gap-1">
                {pendingEmployees && pendingEmployees.length > 0 && (
                  <Badge variant="outline" className="h-4 px-1.5 text-[10px] text-amber-600 border-amber-300">
                    {pendingEmployees.length} pending
                  </Badge>
                )}
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  className="size-6 text-muted-foreground hover:text-foreground"
                  onClick={onRefreshEmployees}
                  disabled={!onRefreshEmployees || employeesRefreshing}
                  aria-label="Refresh employees"
                >
                  <RefreshCwIcon
                    data-icon="inline-start"
                    className={employeesRefreshing ? "animate-spin" : undefined}
                  />
                </Button>
              </div>
            </div>

            {/* Drag & click instruction hint */}
            <Alert className="py-2 px-3 bg-muted/50 border-border/60">
              <AlertDescription className="text-[11px] text-muted-foreground leading-snug">
                Drag or click an employee to add them to the canvas and configure their spending allowance.
              </AlertDescription>
            </Alert>

            {/* Prominent list — interactive draggable & clickable cards */}
            {employees.length === 0 ? (
              <div className="flex items-center justify-center rounded-lg border border-dashed border-border/80 bg-muted/20 px-3 py-4 text-center">
                <p className="text-[11px] text-muted-foreground">
                  No active employees yet. Click &ldquo;Add employee&rdquo; above.
                </p>
              </div>
            ) : (
              <div className="relative">
                <div className="max-h-[14rem] overflow-y-auto space-y-1.5 pr-0.5">
                  {employees.map((employee) => (
                    <div
                      key={employee.id}
                      id={`recipient-${employee.id}`}
                      draggable
                      title={`${employee.label} — drag or click to add to canvas`}
                      onClick={() => onAddEmployee?.(employee.id)}
                      onDragStart={(event) => {
                        event.dataTransfer.setData(
                          "application/allocard-employee-id",
                          employee.id,
                        );
                        event.dataTransfer.effectAllowed = "copy";
                      }}
                      className="group relative flex items-center gap-2 rounded-lg border border-border/80 bg-card/80 p-2 shadow-2xs transition-all duration-150 hover:border-primary/50 hover:bg-accent/60 hover:shadow-xs cursor-grab active:cursor-grabbing select-none"
                    >
                      <div className="flex items-center text-muted-foreground/35 group-hover:text-muted-foreground transition-colors">
                        <GripVertical className="size-3.5" />
                      </div>
                      <div className="flex size-7 shrink-0 items-center justify-center rounded-md border border-border bg-muted/80 text-foreground/80 group-hover:border-primary/40 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                        <UserRoundIcon className="size-3.5" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs font-semibold text-foreground group-hover:text-primary transition-colors">
                          {employee.label}
                        </p>
                        <p className="truncate font-mono text-[10px] text-muted-foreground">
                          {employee.detail}
                        </p>
                      </div>
                      <div className="flex size-5 shrink-0 items-center justify-center rounded text-muted-foreground/40 group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                        <PlusIcon className="size-3.5" />
                      </div>
                    </div>
                  ))}
                </div>
                {/* Fade mask for overflow */}
                {employees.length > 4 && (
                  <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 rounded-b-lg bg-gradient-to-t from-sidebar to-transparent" />
                )}
              </div>
            )}
          </div>
        )}
      </SidebarGroupContent>
    </SidebarGroup>
  );
}

// ---------------------------------------------------------------------------
// Logout footer
// ---------------------------------------------------------------------------

function SidebarLogoutButton() {
  const auth = useAuth();
  const router = useRouter();

  const handleLogout = async () => {
    try {
      router.replace("/");
      if (auth.status === "authenticated") {
        await auth.disconnect();
      }
    } catch (err) {
      console.warn("Logout error:", err);
      window.location.assign("/");
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size="sm"
      onClick={handleLogout}
      className="w-full justify-start text-xs font-medium text-sidebar-foreground border-sidebar-border bg-sidebar hover:bg-sidebar-accent hover:text-sidebar-accent-foreground dark:border-sidebar-border dark:bg-sidebar dark:hover:bg-sidebar-accent focus-visible:border-sidebar-ring focus-visible:ring-sidebar-ring/50 cursor-pointer transition-colors px-2.5 h-8 gap-2 rounded-md"
    >
      <LogOutIcon className="size-3.5 shrink-0" />
      <span>Log out</span>
    </Button>
  );
}

function LogoutMenuItem() {
  const auth = useAuth();
  const router = useRouter();

  return (
    <DropdownMenuItem
      onClick={() => {
        if (auth.status === "authenticated") {
          router.replace("/");
          void auth.disconnect();
        }
      }}
      className="cursor-pointer text-muted-foreground hover:text-foreground"
    >
      <LogOutIcon className="mr-2 h-4 w-4" />
      <span>Log out</span>
    </DropdownMenuItem>
  );
}

// ---------------------------------------------------------------------------
// Root AppSidebar
// ---------------------------------------------------------------------------

export function AppSidebar({
  loading = false,
  agents,
  companyName,
  employees,
  pendingEmployees,
  companyId,
  workspaceOptions,
  onWorkspaceChange,
  onAddEmployee,
  onInviteEmployeeByEmail,
  onRefreshEmployees,
  employeesRefreshing,
  onSelectAgent,
  role,
  smartAccountLabel,
  smartAccountAddress,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  roleLabel: _roleLabel,
  employeeReferenceId,
  ...props
}: React.ComponentProps<typeof Sidebar> & {
  loading?: boolean;
  agents: SidebarAgent[];
  companyName: string;
  employees: SidebarEmployee[];
  pendingEmployees?: { id: string; email: string; createdAt: string }[];
  companyId: string;
  workspaceOptions: WorkspaceOption[];
  onWorkspaceChange?: (companyId: string, role: "employer" | "employee") => void;
  onAddEmployee?: (employeeId: string) => void;
  onInviteEmployeeByEmail?: (email: string) => Promise<void>;
  onRefreshEmployees?: () => void;
  employeesRefreshing?: boolean;
  onSelectAgent?: (agentId: string) => void;
  role?: "employer" | "employee";
  roleLabel: string;
  smartAccountLabel: string;
  smartAccountAddress?: string | null;
  employeeReferenceId?: string;
}) {
  return (
    <Sidebar collapsible="offcanvas" {...props}>

      {/* ── HEADER ─────────────────────────────────────────────────────── */}
      <SidebarHeader className="pb-4 pt-4 px-3 gap-3 relative">
        <div className="absolute right-3 top-3">
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" className="h-6 w-6">
                <MoreVerticalIcon className="h-4 w-4 text-muted-foreground" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <LogoutMenuItem />
            </DropdownMenuContent>
          </DropdownMenu>
        </div>

        <div className="px-1 mt-1">
          <p className="text-[10px] font-medium uppercase tracking-widest text-muted-foreground">
            Workspace
          </p>
          <div className="mt-0.5">
            {loading ? <Skeleton className="h-6 w-36" /> : <h2 className="truncate text-base font-semibold text-foreground">{companyName}</h2>}
          </div>
          {workspaceOptions.length > 1 && onWorkspaceChange && (
            <div className="mt-2.5">
              <Select
                value={companyId}
                onValueChange={(nextCompanyId) => {
                  if (nextCompanyId) {
                    onWorkspaceChange(nextCompanyId, role ?? "employer");
                  }
                }}
              >
                <SelectTrigger className="h-8 w-full text-xs bg-background">
                  <SelectValue placeholder="Switch company" />
                </SelectTrigger>
                <SelectContent>
                  {workspaceOptions.map((workspace) => (
                    <SelectItem
                      key={workspace.companyId}
                      value={workspace.companyId}
                    >
                      {workspace.companyName}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          )}
          {role === "employee" && employeeReferenceId && (
            <div className="mt-2.5 flex items-center justify-between rounded-md border border-primary/25 bg-primary/5 px-2.5 py-1.5 shadow-2xs">
              <span className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
                Employee ID
              </span>
              <span className="font-mono text-xs font-extrabold text-primary tracking-wide">
                {employeeReferenceId}
              </span>
            </div>
          )}
        </div>

        {loading ? <Button variant="ghost" size="sm" disabled className="w-full justify-start text-muted-foreground"><WalletIcon className="size-4" />{role === "employee" ? "Wallet details" : "Treasury details"}</Button> : <SmartAccountAddress
          label={smartAccountLabel} 
          fullAddress={smartAccountAddress} 
          role={role}
        />}
      </SidebarHeader>

      {/* ── CONTENT ────────────────────────────────────────────────────── */}
      <SidebarContent className="gap-0">

        {/* Canvas — employees + AI agents */}
        {loading ? <SidebarGroup><SidebarGroupLabel>{role === "employee" ? "Spending authority" : "Employees"}</SidebarGroupLabel><SidebarGroupContent className="space-y-3 px-2">{role !== "employee" && <Button variant="outline" size="sm" disabled className="w-full"><UserPlusIcon />Add employee</Button>}{[0, 1, 2].map(row => <Skeleton key={row} className="h-12 w-full" />)}</SidebarGroupContent></SidebarGroup> : <CanvasSection
          agents={agents}
          employees={employees}
          pendingEmployees={pendingEmployees}
          onAddEmployee={onAddEmployee}
          onInviteEmployeeByEmail={onInviteEmployeeByEmail}
          onRefreshEmployees={onRefreshEmployees}
          employeesRefreshing={employeesRefreshing}
          onSelectAgent={onSelectAgent}
          role={role}
        />}

      </SidebarContent>

      {/* ── FOOTER ─────────────────────────────────────────────────────── */}
      <SidebarFooter className="border-t border-border/40 p-2">
        <SidebarLogoutButton />
      </SidebarFooter>

    </Sidebar>
  );
}
