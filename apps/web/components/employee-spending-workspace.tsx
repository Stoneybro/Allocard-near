"use client";

import { createContext, useContext, useState, type ReactNode } from "react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

const ResearchVisible = createContext(true);
export const useResearchVisible = () => useContext(ResearchVisible);
export function EmployeeSpendingWorkspace({ directPayment, agents }: { directPayment: ReactNode; agents: ReactNode }) {
  const [route, setRoute] = useState("direct");
  return (
    <Tabs value={route} onValueChange={setRoute} className="min-w-0 gap-4">
      <TabsList aria-label="Spending route" className="grid h-10 w-full grid-cols-2 sm:w-80">
        <TabsTrigger value="direct">Direct payment</TabsTrigger>
        <TabsTrigger value="agents">Agents</TabsTrigger>
      </TabsList>
      <TabsContent value="direct" forceMount className="min-w-0 data-[state=inactive]:hidden">{directPayment}</TabsContent>
      <TabsContent value="agents" forceMount className="min-w-0 data-[state=inactive]:hidden"><ResearchVisible.Provider value={route === "agents"}>{agents}</ResearchVisible.Provider></TabsContent>
    </Tabs>
  );
}
