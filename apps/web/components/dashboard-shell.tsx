"use client";

import type { ReactNode } from "react";
import type { WorkspaceOption } from "@/app/actions/identity";
import {
  AppSidebar,
  type SidebarAgent,
  type SidebarEmployee,
} from "@/components/app-sidebar";
import { SiteHeader } from "@/components/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { CompanyActivationGate } from "@/components/company-activation-gate";
import { DemoGuideProvider, type DemoGuideProgress } from "@/components/demo-guide";

export function DashboardShell({
  loading = false,
  activationRequired = false,
  demoGuide,
  children,
  companyName,
  companyId,
  workspaceOptions,
  onWorkspaceChange,
  employees,
  pendingEmployees,
  agents,
  onAddEmployee,
  onInviteEmployeeByEmail,
  onSelectAgent,
  onRefreshEmployees,
  employeesRefreshing,
  role,
  smartAccountLabel,
  smartAccountAddress,
  employeeReferenceId,
  employeeFullEmail,
  title,
  roleLabel,
}: {
  loading?: boolean;
  activationRequired?: boolean;
  demoGuide?: DemoGuideProgress;
  children: ReactNode;
  companyName: string;
  companyId?: string;
  workspaceOptions?: WorkspaceOption[];
  onWorkspaceChange?: (companyId: string, role: "employer" | "employee") => void;
  employees?: SidebarEmployee[];
  pendingEmployees?: { id: string; email: string; createdAt: string }[];
  agents?: SidebarAgent[];
  onAddEmployee?: (employeeId: string) => void;
  onInviteEmployeeByEmail?: (email: string) => Promise<void>;
  onSelectAgent?: (agentId: string) => void;
  onRefreshEmployees?: () => void;
  employeesRefreshing?: boolean;
  role?: "employer" | "employee";
  smartAccountLabel: string;
  smartAccountAddress?: string | null;
  employeeReferenceId?: string;
  employeeFullEmail?: string | null;
  title: string;
  roleLabel: string;
}) {
  return (
    <DemoGuideProvider key={demoGuide?.scope ?? role} guide={demoGuide}>
    <CompanyActivationGate required={activationRequired}>
    <SidebarProvider
      style={
        {
          "--sidebar-width": "calc(var(--spacing) * 72)",
          "--header-height": "calc(var(--spacing) * 12)",
        } as React.CSSProperties
      }
    >
      <AppSidebar
        loading={loading}
        variant="inset"
        companyName={companyName}
        companyId={companyId ?? ""}
        workspaceOptions={workspaceOptions ?? []}
        onWorkspaceChange={onWorkspaceChange}
        employees={employees ?? []}
        pendingEmployees={pendingEmployees}
        agents={agents ?? []}
        onAddEmployee={onAddEmployee}
        onInviteEmployeeByEmail={onInviteEmployeeByEmail}
        onSelectAgent={onSelectAgent}
        onRefreshEmployees={onRefreshEmployees}
        employeesRefreshing={employeesRefreshing}
        role={role}
        roleLabel={roleLabel}
        smartAccountLabel={smartAccountLabel}
        smartAccountAddress={smartAccountAddress}
        employeeReferenceId={employeeReferenceId}
        employeeFullEmail={employeeFullEmail}
      />
      <SidebarInset className="h-dvh overflow-hidden">
        <SiteHeader title={title} />
        <div className="min-h-0 flex-1 overflow-y-auto p-4 lg:p-6">
          {children}
        </div>
      </SidebarInset>
    </SidebarProvider>
    </CompanyActivationGate>
    </DemoGuideProvider>
  );
}
