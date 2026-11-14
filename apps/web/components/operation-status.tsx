"use client";

import { useEffect, useState } from "react";

/** One status line; optionally replace the initial text after a short wait. */
export function OperationStatus({ message, delayedMessage }: { message: string; delayedMessage?: string }) {
  const [takingLonger, setTakingLonger] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setTakingLonger(true), 5000);
    return () => clearTimeout(timer);
  }, []);
  return <p role="status" aria-live="polite" className="text-xs leading-5 text-muted-foreground">{takingLonger && delayedMessage ? delayedMessage : message}</p>;
}
