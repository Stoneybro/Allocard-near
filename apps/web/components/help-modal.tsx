"use client";

import { HelpCircleIcon } from "lucide-react";
import { ACTIVATION_USDC, MOCK_USDC_ACCOUNT_ID } from "@/lib/chain";
import { DemoGuideRestartButton, useDemoGuide } from "@/components/demo-guide";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { useState } from "react";
import { Accordion, AccordionContent, AccordionItem, AccordionTrigger } from "@/components/ui/accordion";

export function HelpModal() {
  const guide = useDemoGuide();
  const [localOpen, setLocalOpen] = useState(false);
  const open = guide?.helpOpen ?? localOpen;
  const changeOpen = guide?.setHelpOpen ?? setLocalOpen;
  const employee = guide?.role === "employee";

  return (
    <Sheet open={open} onOpenChange={changeOpen}>
      <SheetTrigger asChild>
        <Button data-activation-exempt variant="outline" size="sm" aria-label="Help & Demo Tips" className="demo-help-shine relative h-8 gap-1.5 text-muted-foreground hover:text-foreground">
          <HelpCircleIcon className="size-4" />
          <span className="hidden sm:inline-block">Help & Demo Tips</span>
        </Button>
      </SheetTrigger>
      <SheetContent data-activation-exempt className="w-full gap-6 overflow-y-auto p-6 sm:max-w-sm">
        <SheetHeader className="gap-2 p-0 pr-6">
          <SheetTitle>Help &amp; Demo Tips</SheetTitle>
          <SheetDescription className="leading-6">{employee ? "Keep this employee dashboard open in incognito while you set up the allowance in the employer window." : "Use a second email and an incognito window to try both roles. The separate sign-ins keep each person’s access independent."}</SheetDescription>
        </SheetHeader>
        {!employee && MOCK_USDC_ACCOUNT_ID && <p className="text-sm leading-6 text-muted-foreground">Activation adds {Number(ACTIVATION_USDC).toLocaleString("en-US")} test USDC to your company treasury.</p>}
        <ol className="list-decimal space-y-5 pl-5 text-sm leading-6 marker:text-muted-foreground">
          {employee ? <>
            <li><span className="font-medium">Set up the allowance.</span><br />Return to the employer window. Add a delegation for this employee, set an amount and policy, then activate it.</li>
            <li><span className="font-medium">Try spending.</span><br />Come back here to make a direct payment or use an agent.</li>
          </> : <>
          <li><span className="font-medium">Add an employee.</span><br />Use another email you can access.</li>
          <li><span className="font-medium">Accept the invitation.</span><br />Open allocard.xyz in incognito, sign in with that email, and complete onboarding.</li>
          <li><span className="font-medium">Set a spending limit.</span><br />Back in the company window, add a delegation, configure it, and activate.</li>
          <li><span className="font-medium">Try spending.</span><br />In the employee window, make a direct payment or set up an agent for research.</li>
          </>}
        </ol>
        <Accordion type="single" collapsible className="border-t border-border pt-2">
          <AccordionItem value="about">
            <AccordionTrigger>What is this demo about?</AccordionTrigger>
            <AccordionContent className="leading-6 text-muted-foreground">
              <p>Allocard demonstrates delegated corporate spending. Instead of sending money to employees or loading funded cards for expenses, the employer grants permission to spend from a company treasury.</p>
              <p>The allowance never enters the employee’s NEAR account. That account signs payment requests; the treasury pays recipients directly under onchain policy. The employer controls unused funds, sets spending limits and approved recipients, and can revoke future access.</p>
            </AccordionContent>
          </AccordionItem>
        </Accordion>
        <DemoGuideRestartButton />
      </SheetContent>
    </Sheet>
  );
}
