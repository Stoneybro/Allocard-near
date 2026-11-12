"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { RotateCcwIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { demoGuideStorageKey } from "@/lib/demo-guide-preferences";

export type DemoGuideProgress = { scope: string; step: 0 | 1 | 2 | 3 | 4; role?: "employer" | "employee" };
type Preference = { enabled: boolean; seenStep: number; openedHelp: boolean };
type GuideContext = { role: "employer" | "employee"; nudge: boolean; helpOpen: boolean; setHelpOpen: (open: boolean) => void; restart: (() => void) | null };
const Context = createContext<GuideContext | null>(null);
export const useDemoGuide = () => useContext(Context);

const directions = [
  null,
  { title: "Add an employee", text: "Click Add Employee in the sidebar on the left. Enter another email you can access to use as your employee." },
  { title: "Join as the employee", text: "Open allocard.xyz in an incognito window. Sign in with that email, complete onboarding, and accept the company invitation. Then return here." },
  { title: "Set their spending limit", text: "Click Add delegation, select your employee, and configure their spending limits. Activate the delegation when you’re ready." },
  { title: "Try the employee dashboard", text: "Return to the employee dashboard in incognito. You can now make a direct payment or set up an agent for research." },
];

const employeeDirections = [
  null,
  { title: "Next step", text: "Go back to the employer dashboard." },
  { title: "Your allowance is ready", text: "You can now make a direct payment or use an agent from this dashboard. That’s the end of the demo." },
];

export function DemoGuideProvider({ guide, children }: { guide?: DemoGuideProgress; children: ReactNode }) {
  const [prompt, setPrompt] = useState<number | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [nudge, setNudge] = useState(false);
  const [hideAgain, setHideAgain] = useState(false);
  const preference = useRef<Preference | null>(null);
  const replaying = useRef(false);
  const step = guide?.step;
  const key = guide ? demoGuideStorageKey(guide.scope) : null;
  const lastStep = guide?.role === "employee" ? 2 : 4;

  function save(value: Preference) {
    preference.current = value;
    if (key) {
      try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* Keep the preference for this session when storage is blocked. */ }
    }
  }

  useEffect(() => {
    if (!key || step === undefined) return;
    let saved = preference.current;
    if (!saved) {
      try {
        const raw = localStorage.getItem(key);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (typeof parsed.enabled === "boolean" && Number.isInteger(parsed.seenStep) && parsed.seenStep >= 0 && parsed.seenStep <= lastStep && typeof parsed.openedHelp === "boolean") saved = parsed;
        }
        // Respect opt-outs and completed walkthroughs from the previous guide.
        if (!saved) {
          const old = JSON.parse(localStorage.getItem(key.replace(":v2:", ":v1:")) ?? "null");
          if (old && typeof old.eligible === "boolean" && Number.isInteger(old.seenStep)) saved = { enabled: old.eligible && !old.suppressed && old.seenStep < 4, seenStep: old.seenStep, openedHelp: !!old.opened };
        }
      } catch { /* Browser storage is optional. */ }
    }
    saved ??= { enabled: step === 0, seenStep: step, openedHelp: false };
    preference.current = saved;
    try { localStorage.setItem(key, JSON.stringify(saved)); } catch { /* Optional persistence. */ }
    setNudge(saved.enabled && !saved.openedHelp);
    if (!saved.enabled || step === 0 || step <= saved.seenStep || helpOpen) return;

    // Let an invitation/settings dialog close before showing the next direction.
    let timer: ReturnType<typeof setTimeout>;
    function showWhenReady() {
      if (document.querySelector('[role="dialog"], [role="alertdialog"]')) {
        timer = setTimeout(showWhenReady, 300);
        return;
      }
      const current = preference.current!;
      if (!current.enabled) return;
      const next = { ...current, seenStep: step!, openedHelp: true };
      preference.current = next;
      try { localStorage.setItem(key!, JSON.stringify(next)); } catch { /* Optional persistence. */ }
      setNudge(false);
      setHideAgain(false);
      setPrompt(step!);
    }
    timer = setTimeout(showWhenReady, 0);
    return () => clearTimeout(timer);
  }, [key, step, helpOpen, lastStep]);

  function acknowledge() {
    if (preference.current) save({ ...preference.current, enabled: !hideAgain && prompt !== lastStep && preference.current.enabled });
    if (replaying.current && !hideAgain && prompt !== null && prompt < (step ?? 0)) {
      save({ enabled: true, seenStep: prompt + 1, openedHelp: true });
      setPrompt(prompt + 1);
    } else {
      replaying.current = false;
      setPrompt(null);
    }
  }

  function restart() {
    save({ enabled: true, seenStep: step ? 1 : 0, openedHelp: true });
    setHideAgain(false);
    setNudge(false);
    setHelpOpen(false);
    replaying.current = true;
    if (step) setPrompt(1);
  }

  const direction = prompt === null ? null : (guide?.role === "employee" ? employeeDirections : directions)[prompt];
  return (
    <Context.Provider value={{ role: guide?.role ?? "employer", nudge, helpOpen, setHelpOpen: value => {
      setHelpOpen(value);
      if (value) {
        setNudge(false);
        if (preference.current) save({ ...preference.current, openedHelp: true });
      }
    }, restart: guide ? restart : null }}>
      {children}
      <Dialog open={!!direction} onOpenChange={value => { if (!value) acknowledge(); }}>
        <DialogContent data-activation-exempt showCloseButton={false} className="gap-4 p-5 sm:max-w-sm">
          {prompt === 1 && guide?.role !== "employee" && (
            <p role="note" className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-xs leading-5 text-muted-foreground">
              We’ll guide you through the demo one step at a time. You can stop the directions using the checkbox below. Look at the first step below.
            </p>
          )}
          <DialogHeader className="gap-2">
            <DialogTitle>{direction?.title}</DialogTitle>
            <DialogDescription className="text-left leading-6">
              {direction?.text}
            </DialogDescription>
          </DialogHeader>
          <div className="flex items-center justify-between gap-3 pt-1">
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <input type="checkbox" checked={hideAgain} onChange={event => {
                setHideAgain(event.target.checked);
                if (preference.current) save({ ...preference.current, enabled: !event.target.checked });
              }} className="size-3.5 accent-foreground" />
              Stop demo directions
            </label>
            <Button onClick={acknowledge}>Okay</Button>
          </div>
        </DialogContent>
      </Dialog>
    </Context.Provider>
  );
}

export function DemoGuideRestartButton() {
  const guide = useDemoGuide();
  if (!guide?.restart) return null;
  return <Button data-activation-exempt variant="outline" size="sm" onClick={guide.restart} className="h-8 w-full justify-start gap-2 px-2.5 text-xs text-muted-foreground"><RotateCcwIcon className="size-3.5" />Restart demo guide</Button>;
}
