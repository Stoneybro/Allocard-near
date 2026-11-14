// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { OperationStatus } from "@/components/operation-status";

it("replaces the single status line after five seconds and keeps the final stage without counters", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.useFakeTimers();
  const host = document.createElement("div"), root = createRoot(host);
  try {
    await act(async () => root.render(<OperationStatus message="Setting up your account…" delayedMessage="Setting up your account. This may take a few seconds." />));
    expect(host.textContent).toBe("Setting up your account…");
    await act(async () => vi.advanceTimersByTime(5000));
    expect(host.textContent).toBe("Setting up your account. This may take a few seconds.");
    expect(host.querySelectorAll('[role="status"]')).toHaveLength(1);
    await act(async () => root.render(<OperationStatus message="Adding your demo funds…" />));
    await act(async () => vi.advanceTimersByTime(60000));
    expect(host.textContent).toBe("Adding your demo funds…");
  } finally { await act(async () => root.unmount()); vi.useRealTimers(); }
});
