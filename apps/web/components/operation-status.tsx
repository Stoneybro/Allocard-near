"use client";

import { useEffect, useState } from "react";

/** One status line; optionally replace the initial text after a short wait. */
export function OperationStatus({ message, delayedMessage, extendedMessage }: { message: string; delayedMessage?: string; extendedMessage?: string }) {
  const [takingLonger, setTakingLonger] = useState(false);
  const [extendedWait, setExtendedWait] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTakingLonger(true), 5000);
    const extendedTimer = setTimeout(() => setExtendedWait(true), 15000);
    return () => { clearTimeout(timer); clearTimeout(extendedTimer); };
  }, []);
  return <p role="status" aria-live="polite" className="text-xs leading-5 text-muted-foreground">{extendedWait && extendedMessage ? extendedMessage : takingLonger && delayedMessage ? delayedMessage : message}</p>;
}
