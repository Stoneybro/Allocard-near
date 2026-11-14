"use client";

import { useEffect, useState } from "react";

/** Mount while an operation runs. Elapsed time is feedback, not invented progress. */
export function OperationStatus({ message }: { message: string }) {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const timer = setInterval(() => setElapsed(Math.floor((Date.now() - started) / 1000)), 1000);
    return () => clearInterval(timer);
  }, []);
  return <div className="space-y-1 text-xs leading-5 text-muted-foreground">
    <div className="flex flex-wrap items-center gap-x-2"><span role="status" aria-live="polite">{message}</span>{elapsed > 0 && <span aria-hidden="true" className="tabular-nums">{elapsed}s</span>}</div>
    {elapsed >= 15 && <p>Still working. Keep this tab open; no need to submit again.</p>}
  </div>;
}
