// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vitest";
import { SectionCards } from "@/components/section-cards";
import { EmployeeSectionCards } from "@/components/employee-section-cards";
it.each(["employer", "employee"])("keeps %s balances visible while one explicit refresh runs", async role => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  let finish!: () => void;
  const refresh = vi.fn(() => new Promise<void>(resolve => { finish = resolve; }));
  const host = document.createElement("div"); document.body.append(host); const root = createRoot(host);
  try {
    await act(async () => root.render(role === "employer" ? <SectionCards smartAccountBalance="2000" onRefresh={refresh} /> : <EmployeeSectionCards remainingNear="2000" onRefresh={refresh} />));
    const before = host.textContent;
    const button = host.querySelector<HTMLButtonElement>('[aria-label="Refresh dashboard balances"]')!;
    await act(async () => { button.click(); button.click(); });
    expect(refresh).toHaveBeenCalledTimes(1);
    expect(button.disabled).toBe(true);
    expect(host.textContent).toBe(before);
    expect(host.textContent).toContain("2000");
    await act(async () => finish());
    expect(button.disabled).toBe(false);
    expect(host.textContent).toBe(before);
  } finally { await act(async () => root.unmount()); host.remove(); }
});
