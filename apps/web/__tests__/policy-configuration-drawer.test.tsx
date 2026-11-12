// @vitest-environment jsdom
import { act, useState, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
vi.mock("@/components/ui/drawer", () => ({
  Drawer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DrawerHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
  DrawerTitle: ({ children }: { children: ReactNode }) => <h2>{children}</h2>,
  DrawerDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
  DrawerFooter: ({ children }: { children: ReactNode }) => <footer>{children}</footer>,
}));
import { PolicyConfigurationDrawer } from "@/app/employer/PolicyConfigurationDrawer";
import { DEMO_POLICY, emptyCaveatForm, type CaveatForm } from "@/lib/policy-configuration";
let host: HTMLDivElement, root: Root;
const activate = vi.fn(), close = vi.fn(), fetchMock = vi.fn();
const validForm: CaveatForm = { ...emptyCaveatForm, maxAmountNear: "50", period: "weekly", periodAmountNear: "10", perTransactionCapNear: "5", allowedTargets: "vendor.testnet", limitedCallsEnabled: true, limitedCalls: "20", expiresAt: "2099-01-01T00:00:00Z" };
function Harness({ initial = emptyCaveatForm, busy = false }: { initial?: CaveatForm; busy?: boolean }) {
  const [form, setForm] = useState(initial);
  return <PolicyConfigurationDrawer open mobile={false} identity="Alex" account="alex.testnet" companyId="company" status="pending_config" form={form} setForm={setForm} balance="100" busy={busy} stage="Confirming permission…" error={null} recovery={false} onClose={close} onActivate={activate} onRevoke={vi.fn()} />;
}
const button = (text: string) => [...host.querySelectorAll("button")].find(item => item.textContent?.includes(text))!;
async function click(text: string) { await act(async () => button(text).click()); }
beforeEach(() => {
  vi.clearAllMocks(); vi.stubGlobal("fetch", fetchMock);
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => { callback(0); return 0; });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.unstubAllGlobals(); });

it("starts with the editable demo policy and a prominent manual alternative", async () => {
  await act(async () => root.render(<Harness />));
  expect(host.querySelector<HTMLTextAreaElement>("#ai-policy")?.value).toBe(DEMO_POLICY);
  expect(button("Configure manually")).toBeTruthy();
  expect(host.querySelector("#policy-maxAmountNear")).toBeNull();
  await click("Configure manually");
  expect(host.querySelector("#policy-maxAmountNear")).toBeTruthy();
  await click("Review policy");
  expect(host.querySelector('[role="alert"]')).toBeTruthy();
  expect(activate).not.toHaveBeenCalled();
});
it("reviews all AI settings in plain language, with a separate acknowledged signing step", async () => {
  await act(async () => root.render(<Harness />));
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, provider: "near-ai", formValues: validForm, warnings: [] }) });
  await click("Review policy");
  expect(host.textContent).toContain("20 payments");
  expect(host.textContent).toContain("every 7 days");
  expect(host.textContent).toContain("vendor.testnet");
  expect(host.textContent).toContain("Expires");
  expect(activate).not.toHaveBeenCalled();
  expect(button("Sign & activate").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Sign & activate");
  expect(activate).toHaveBeenCalledTimes(1);
});
it("keeps unclear or unavailable AI results out of the signing flow", async () => {
  await act(async () => root.render(<Harness />));
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: false, provider: "near-ai", formValues: validForm, clarificationQuestions: ["Which total budget should apply?"], warnings: [] }) });
  await click("Review policy");
  expect(host.textContent).toContain("Which total budget should apply?");
  expect(host.querySelector("#ai-policy")).toBeTruthy();
  expect(button("Sign & activate")).toBeUndefined();
  expect(activate).not.toHaveBeenCalled();
});
it("replaces stale manual limits when the new AI policy omits them", async () => {
  await act(async () => root.render(<Harness initial={validForm} />));
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, provider: "near-ai", formValues: { ...emptyCaveatForm, maxAmountNear: "50" }, warnings: [] }) });
  await click("Review policy");
  expect(host.textContent).toContain("Payments to any recipient");
  expect(host.textContent).toContain("No expiration date");
  expect(host.textContent).toContain("No separate limit on the number");
  expect(host.querySelector("ul")?.textContent).not.toContain("vendor.testnet");
});
it("blocks conflicting AI output instead of showing a successful review", async () => {
  await act(async () => root.render(<Harness />));
  fetchMock.mockResolvedValue({ ok: true, json: async () => ({ success: true, provider: "near-ai", formValues: { ...validForm, periodAmountNear: "100" }, warnings: [] }) });
  await click("Review policy");
  expect(host.textContent).toContain("recurring allowance cannot exceed");
  expect(button("Sign & activate")).toBeUndefined();
});
it("locks editing and close while signing and announces progress", async () => {
  await act(async () => root.render(<Harness busy />));
  expect(host.querySelector<HTMLTextAreaElement>("#ai-policy")?.disabled).toBe(true);
  expect(host.querySelector<HTMLButtonElement>('[aria-label="Close policy drawer"]')?.disabled).toBe(true);
  expect(button("Configure manually").disabled).toBe(true);
  expect(host.querySelector('[role="status"]')?.textContent).toContain("Confirming");
});
it("uses the same review and acknowledgement for manual configuration", async () => {
  await act(async () => root.render(<Harness initial={validForm} />));
  await click("Configure manually");
  await click("Review policy");
  expect(fetchMock).not.toHaveBeenCalled();
  expect(host.textContent).toContain("vendor.testnet");
  expect(button("Sign & activate").disabled).toBe(true);
  await act(async () => host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click());
  await click("Sign & activate");
  expect(activate).toHaveBeenCalledTimes(1);
});
it("shows AI network failures inline and leaves manual setup available", async () => {
  await act(async () => root.render(<Harness />));
  fetchMock.mockRejectedValue(new Error("Network unavailable"));
  await click("Review policy");
  expect(host.querySelector('[role="alert"]')?.textContent).toContain("Network unavailable");
  expect(button("Configure manually").disabled).toBe(false);
  expect(activate).not.toHaveBeenCalled();
});
it("aborts a pending AI response when the drawer unmounts", async () => {
  let resolve!: (response: unknown) => void;
  fetchMock.mockImplementation(() => new Promise(done => { resolve = done; }));
  await act(async () => root.render(<Harness />));
  await click("Review policy");
  const signal = fetchMock.mock.calls[0][1].signal as AbortSignal;
  expect(button("Configure manually").disabled).toBe(true);
  await act(async () => root.render(<div />));
  expect(signal.aborted).toBe(true);
  await act(async () => resolve({ ok: true, json: async () => ({ success: true, provider: "near-ai", formValues: validForm, warnings: [] }) }));
  expect(activate).not.toHaveBeenCalled();
});
