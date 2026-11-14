// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { expect, it, vi } from "vitest";
vi.mock("@/hooks/use-account-queries", () => ({ useAccountScope: () => ({ key: ["test"] }), useSettlementRefresh: () => vi.fn() }));
vi.mock("sonner", () => ({ toast: { success: vi.fn(), error: vi.fn(), warning: vi.fn() } }));
import { DirectSpendForm } from "@/app/employee/DirectSpendForm";
it("normalizes typed recipients and keeps confirmation busy until the payment completes", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let finish!: (hash: string) => void;
  const execute = vi.fn((_details: { toAddress: string }, _settled?: (hash: string) => void, progress?: (message: string) => void) => {
    progress?.("Confirming payment on NEAR…"); return new Promise<string>(resolve => { finish = resolve; });
  });
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><DirectSpendForm companyId="company" delegationId="permission" remainingBalanceNear="10" onExecute={execute} /></QueryClientProvider>));
    for (const [id, value] of [["#ds-to", " Vendor.Testnet "], ["#ds-amount", "1"]]) await act(async () => {
      const input = host.querySelector<HTMLInputElement>(id)!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => [...host.querySelectorAll("button")].find(button => button.textContent === "Review payment")!.click());
    await act(async () => [...document.querySelectorAll("button")].find(button => button.textContent?.includes("Confirm & Execute"))!.click());
    expect(execute.mock.calls[0][0].toAddress).toBe("vendor.testnet");
    const dialog = document.querySelector('[role="alertdialog"]')!;
    expect(dialog.textContent).toContain("Confirming payment on NEAR");
    const submit = [...dialog.querySelectorAll("button")].find(button => button.textContent?.includes("Sending payment"))!;
    expect(submit.disabled).toBe(true);
    await act(async () => submit.click()); expect(execute).toHaveBeenCalledTimes(1);
    await act(async () => finish("confirmed-hash")); expect(host.textContent).toContain("Spend Settled");
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
it("shows a confirmed payment before history finishes and offers history-only recovery on failure", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let failHistory!: (reason: Error) => void;
  const execute = vi.fn((_details, onSettled?: (hash: string) => void) => { onSettled?.("confirmed-hash"); return new Promise<string>((_resolve, reject) => { failHistory = reject; }); });
  const change = async (id: string, value: string) => { await act(async () => {
    const input = host.querySelector<HTMLInputElement>(id)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }); };
  try {
    await act(async () => root.render(<QueryClientProvider client={client}><DirectSpendForm companyId="company" delegationId="permission" remainingBalanceNear="10" onExecute={execute} /></QueryClientProvider>));
    await change("#ds-to", "vendor.testnet"); await change("#ds-amount", "1");
    await act(async () => [...host.querySelectorAll("button")].find(b => b.textContent?.includes("Review payment"))!.click());
    await act(async () => [...document.querySelectorAll("button")].find(b => b.textContent?.includes("Confirm & Execute"))!.click());
    expect(host.textContent).toContain("Spend Settled");
    expect(host.textContent).toContain("Saving history");
    await act(async () => failHistory(new Error("history unavailable")));
    expect(host.textContent).toContain("Payment sent");
    expect(host.textContent).toContain("Sync payment history");
    expect(execute).toHaveBeenCalledTimes(1);
  } finally { await act(async () => root.unmount()); client.clear(); host.remove(); }
});
