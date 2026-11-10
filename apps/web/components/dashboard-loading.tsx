"use client";

import { DashboardShell } from "@/components/dashboard-shell";
import { SectionCards } from "@/components/section-cards";
import { EmployeeSpendingWorkspace } from "@/components/employee-spending-workspace";
import { EmployeeSectionCards } from "@/components/employee-section-cards";
import { DelegationCardsView } from "@/components/delegation-cards-view";
import { DirectSpendForm } from "@/app/employee/DirectSpendForm";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Skeleton } from "@/components/ui/skeleton";

const unavailableSpend = async (): Promise<string> => { throw new Error("Wait for your workspace to finish loading."); };

export function DashboardLoading({ role = "employer", companyName }: { role?: "employer" | "employee"; companyName?: string }) {
  const employer = role === "employer";
  return (
    <DashboardShell loading role={role} companyName={companyName ?? ""} smartAccountLabel="" title={employer ? "Company dashboard" : "Employee dashboard"} roleLabel={employer ? "Company owner" : "Employee"}>
      <div className={`flex flex-col ${employer ? "min-h-full gap-4" : "gap-4"}`} aria-busy="true" aria-label="Loading workspace">
        <span role="status" className="sr-only">Loading workspace</span>
        {employer ? <>
          <SectionCards loading />
          <Tabs defaultValue="canvas" className="w-full">
            <TabsList className="mb-4"><TabsTrigger value="canvas">Delegations</TabsTrigger><TabsTrigger value="activity">Activity Log</TabsTrigger></TabsList>
            <TabsContent value="canvas" className="mt-0">
              <DelegationCardsView loading company={{ id: "", name: "", smartAccountAddress: null }} employees={[]} delegations={[]} viewMode="cards" onViewModeChange={() => {}} />
            </TabsContent>
            <TabsContent value="activity" className="space-y-4"><p className="text-lg font-semibold">Activity Log</p>{[0, 1, 2].map(row => <Skeleton key={row} className="h-14 w-full" />)}</TabsContent>
          </Tabs>
        </> : <>
          <EmployeeSectionCards loading />
          <EmployeeSpendingWorkspace directPayment={<DirectSpendForm loading companyId="" delegationId="" remainingBalanceNear="" onExecute={unavailableSpend} />} agents={<div aria-busy="true" className="space-y-3 rounded-xl border p-4">{[0, 1, 2].map(row => <Skeleton key={row} className="h-14 w-full" />)}</div>} />
        </>}
      </div>
    </DashboardShell>
  );
}
