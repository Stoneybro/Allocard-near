"use client";

import type { ReactNode, SyntheticEvent } from "react";
import { toast } from "sonner";

/** Keep locked actions clickable so users can discover how to unlock them. */
export function CompanyActivationGate({ required, children }: { required: boolean; children: ReactNode }) {
  const intercept = (event: SyntheticEvent) => {
    if (!required || !(event.target instanceof Element)) return;
    if (event.target.closest("[data-activation-exempt]")) return;
    if (!event.target.closest('button, [role="button"], [role="tab"], [draggable="true"]')) return;
    event.preventDefault();
    event.stopPropagation();
    toast.info("Activate your company account", {
      id: "company-activation-required",
      description: "Activate your account above to unlock dashboard actions.",
    });
  };

  return (
    <div
      className={required ? "contents [&_button:not([data-activation-exempt])]:cursor-not-allowed [&_button:not([data-activation-exempt])]:opacity-50" : "contents"}
      onClickCapture={intercept}
      onPointerDownCapture={intercept}
      onDragStartCapture={intercept}
      onKeyDownCapture={event => {
        if (["Enter", " ", "ArrowDown", "ArrowUp"].includes(event.key)) intercept(event);
      }}
    >
      {children}
    </div>
  );
}
