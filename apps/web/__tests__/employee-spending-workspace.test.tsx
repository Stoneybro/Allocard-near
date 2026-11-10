// @vitest-environment jsdom
import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { EmployeeSpendingWorkspace } from "@/components/employee-spending-workspace";

function Draft({ label }: { label: string }) {
  const [value, setValue] = useState("");
  return <input aria-label={label} value={value} onChange={event => setValue(event.target.value)} />;
}
it("defaults to direct payment and retains both drafts while switching spending routes", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const host = document.createElement("div"); document.body.append(host);
  const root = createRoot(host);
  const inputValue = async (label: string, value: string) => act(async () => {
    const input = host.querySelector<HTMLInputElement>(`input[aria-label="${label}"]`)!;
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  const switchTo = async (label: string) => act(async () => {
    const tab = [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]')].find(item => item.textContent === label)!;
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
    tab.click();
  });
  try {
    await act(async () => root.render(<EmployeeSpendingWorkspace directPayment={<Draft label="Recipient" />} agents={<Draft label="Research prompt" />} />));
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Direct payment");
    await inputValue("Recipient", "vendor.testnet");
    await switchTo("Agents");
    expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toBe("Agents");
    await inputValue("Research prompt", "Compare support tools");
    await switchTo("Direct payment");
    expect(host.querySelector<HTMLInputElement>('[aria-label="Recipient"]')?.value).toBe("vendor.testnet");
    await switchTo("Agents");
    expect(host.querySelector<HTMLInputElement>('[aria-label="Research prompt"]')?.value).toBe("Compare support tools");
  } finally { await act(async () => root.unmount()); host.remove(); }
});
