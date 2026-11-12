// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/lib/chain", () => ({ ACTIVATION_USDC: "2000", MOCK_USDC_ACCOUNT_ID: "usdc.testnet" }));
const notice = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: { info: notice } }));
import { HelpModal } from "@/components/help-modal";
import { DemoGuideProvider, type DemoGuideProgress } from "@/components/demo-guide";
import { CompanyActivationGate } from "@/components/company-activation-gate";
import { demoGuideStorageKey, employeeDemoScope, prepareEmployeeDemo } from "@/lib/demo-guide-preferences";

let host: HTMLDivElement, root: Root;
const prompt = () => document.querySelector('[data-slot="dialog-content"]');
const drawer = () => document.querySelector('[data-slot="sheet-content"]');
async function flush() { await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); }); }
async function render(step: DemoGuideProgress["step"], scope = "owner:company", role?: DemoGuideProgress["role"]) {
  await act(async () => root.render(
    <DemoGuideProvider key={scope} guide={{ scope, step, role }}>
      <CompanyActivationGate required={step === 0}><HelpModal /></CompanyActivationGate>
    </DemoGuideProvider>,
  ));
  await flush();
}
async function click(label: string) {
  const button = [...document.querySelectorAll<HTMLButtonElement>("button")].find(item => item.getAttribute("aria-label") === label || item.textContent === label);
  expect(button, label).toBeTruthy();
  await act(async () => button!.click());
  await flush();
}
async function optOut() {
  const checkbox = prompt()!.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
  await act(async () => checkbox.click());
  expect(checkbox.checked).toBe(true);
}
async function remount(step: DemoGuideProgress["step"]) {
  await act(async () => root.unmount());
  root = createRoot(host);
  await render(step);
}
beforeEach(() => {
  vi.clearAllMocks(); localStorage.clear();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); });

it("opens a plain help drawer before activation, separately from automatic prompts", async () => {
  await render(0);
  expect(prompt()).toBeNull();
  expect(host.querySelector('.demo-help-shine')).not.toBeNull();
  await click("Help & Demo Tips");
  expect(drawer()?.textContent).toContain("second email");
  expect(drawer()?.textContent).toContain("2,000 test USDC to your company treasury");
  expect(drawer()?.querySelectorAll("ol > li")).toHaveLength(4);
  expect(drawer()?.querySelector('[data-slot="accordion-trigger"]')?.getAttribute("aria-expanded")).toBe("false");
  expect([...drawer()!.querySelectorAll("button")].some(button => /^(Next|Back)$/.test(button.textContent ?? ""))).toBe(false);
  await click("What is this demo about?");
  expect(drawer()?.textContent).toContain("The allowance never enters the employee’s NEAR account");
  expect(drawer()?.textContent).toContain("can revoke future access");
  expect(prompt()).toBeNull();
  expect(notice).not.toHaveBeenCalled();
  expect(host.querySelector('.demo-help-shine')).not.toBeNull();
});

it("shows one short prompt per milestone and finishes permanently after the last Okay", async () => {
  await render(0);
  for (const [step, text] of [[1, "Add an employee"], [2, "Join as the employee"], [3, "Set their spending limit"], [4, "Try the employee dashboard"]] as const) {
    await render(step);
    expect(prompt()?.textContent).toContain(text);
    expect(prompt()?.textContent).toContain("Stop demo directions");
    if (step === 1) {
      expect(prompt()?.querySelector('[role="note"]')?.textContent).toContain("Look at the first step below.");
      expect(prompt()?.querySelector('[data-slot="dialog-description"]')?.textContent).not.toContain("We’ll guide you");
    } else expect(prompt()?.querySelector('[role="note"]')).toBeNull();
    expect(prompt()?.querySelectorAll("button")).toHaveLength(1);
    expect(prompt()?.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(drawer()).toBeNull();
    await click("Okay");
    await render(step);
    expect(prompt()).toBeNull();
    await remount(step);
    expect(prompt()).toBeNull();
  }
  await render(1); await render(2); await render(4);
  expect(prompt()).toBeNull();
  expect(JSON.parse(localStorage.getItem("allocard:demo-guide:v2:owner:company")!).enabled).toBe(false);
});

it.each([1, 2, 3, 4] as const)("remembers the checkbox opt-out at step %s and keeps manual help available", async step => {
  await render(0); await render(step);
  await optOut(); await click("Okay");
  await remount(step); await render(4);
  expect(prompt()).toBeNull();
  await click("Help & Demo Tips");
  expect(drawer()).not.toBeNull();
});

it("only starts automatically for new workspaces and scopes preferences to the company", async () => {
  await render(3); await render(4);
  expect(prompt()).toBeNull();
  expect(host.querySelector('.demo-help-shine')).not.toBeNull();
  await render(0, "owner:new-company"); await render(1, "owner:new-company");
  expect(prompt()?.textContent).toContain("Add an employee");
});

it("lets the help drawer restart a completed guide, then finishes again", async () => {
  await render(0); await render(4); await click("Okay");
  await click("Help & Demo Tips");
  await click("Restart demo guide");
  expect(drawer()).toBeNull();
  for (const title of ["Add an employee", "Join as the employee", "Set their spending limit", "Try the employee dashboard"]) {
    expect(prompt()?.textContent).toContain(title);
    await click("Okay");
  }
  await remount(4);
  expect(prompt()).toBeNull();
});

it("does not interrupt the help drawer with a milestone prompt", async () => {
  await render(0); await click("Help & Demo Tips");
  await render(1);
  expect(prompt()).toBeNull();
  await click("Close");
  await flush();
  expect(prompt()?.textContent).toContain("Add an employee");
});

it("keeps a previous guide's opt-out when updating the UI", async () => {
  localStorage.setItem("allocard:demo-guide:v1:owner:company", JSON.stringify({ eligible: false, suppressed: true, seenStep: 1, opened: true }));
  await render(0); await render(2);
  expect(prompt()).toBeNull();
});

it("continues working when browser storage is blocked", async () => {
  vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => { throw new Error("Storage blocked"); });
  await render(0); await render(1);
  expect(prompt()?.textContent).toContain("Add an employee");
  await optOut(); await click("Okay"); await render(2);
  expect(prompt()).toBeNull();
});

it("guides a newly joined employee through delegation and spending, then stays finished until restarted", async () => {
  const scope = employeeDemoScope("employee", "company");
  prepareEmployeeDemo("employee", "company");
  await render(1, scope, "employee");
  expect(prompt()?.textContent).toContain("Go back to the employer dashboard.");
  expect(prompt()?.textContent).not.toContain("configure a policy");
  expect(prompt()?.querySelector('[role="note"]')).toBeNull();
  await click("Okay");
  await render(2, scope, "employee");
  expect(prompt()?.textContent).toContain("Your allowance is ready");
  expect(prompt()?.textContent).toContain("That’s the end of the demo");
  await click("Okay");
  expect(JSON.parse(localStorage.getItem(demoGuideStorageKey(scope))!).enabled).toBe(false);
  await act(async () => root.unmount()); root = createRoot(host);
  await render(2, scope, "employee");
  expect(prompt()).toBeNull();
  await click("Help & Demo Tips");
  expect(drawer()?.querySelectorAll("ol > li")).toHaveLength(2);
  await click("Restart demo guide");
  expect(prompt()?.textContent).toContain("Go back to the employer dashboard.");
  await click("Okay");
  expect(prompt()?.textContent).toContain("Your allowance is ready");
  await click("Okay");
  expect(prompt()).toBeNull();
});

it("keeps existing employees quiet and preserves an employee opt-out separately from the employer guide", async () => {
  const scope = employeeDemoScope("employee", "company");
  await render(1, scope, "employee");
  await render(2, scope, "employee");
  expect(prompt()).toBeNull();
  const fresh = employeeDemoScope("new-employee", "company");
  prepareEmployeeDemo("new-employee", "company");
  await render(1, fresh, "employee");
  await optOut(); await click("Okay");
  prepareEmployeeDemo("new-employee", "company");
  await render(2, fresh, "employee");
  expect(prompt()).toBeNull();
  await render(0); await render(1);
  expect(prompt()?.textContent).toContain("Add an employee");
});
