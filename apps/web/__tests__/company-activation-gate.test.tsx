// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ notice: vi.fn() }));
vi.mock("sonner", () => ({ toast: { info: mocks.notice } }));
import { CompanyActivationGate } from "@/components/company-activation-gate";

let root: Root;
let host: HTMLDivElement;
const action = vi.fn();
const activate = vi.fn();
const logout = vi.fn();
async function render(required: boolean) {
  await act(async () => root.render(
    <CompanyActivationGate required={required}>
      <button id="action" onClick={action} onPointerDown={action} onKeyDown={action}><span>Add funds</span></button>
      <button id="activate" data-activation-exempt onClick={activate}>Activate</button>
      <button id="logout" data-activation-exempt onClick={logout}>Log out</button>
    </CompanyActivationGate>,
  ));
}
beforeEach(() => {
  vi.clearAllMocks();
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  host = document.createElement("div");
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); });

describe("company activation requirement", () => {
  it.each(["click", "pointerdown", "keydown"])("blocks %s before actions run and explains activation", async type => {
    await render(true);
    const event = type === "keydown" ? new KeyboardEvent(type, { key: "Enter", bubbles: true, cancelable: true }) : new MouseEvent(type, { bubbles: true, cancelable: true });
    await act(async () => { host.querySelector("#action span")!.dispatchEvent(event); });
    expect(action).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
    expect(mocks.notice).toHaveBeenCalledWith("Activate your company account", expect.any(Object));
  });
  it("keeps activation and sign-out available", async () => {
    await render(true);
    await act(async () => {
      host.querySelector<HTMLButtonElement>("#activate")!.click();
      host.querySelector<HTMLButtonElement>("#logout")!.click();
    });
    expect(activate).toHaveBeenCalledTimes(1);
    expect(logout).toHaveBeenCalledTimes(1);
    expect(mocks.notice).not.toHaveBeenCalled();
  });
  it("unlocks actions immediately after activation", async () => {
    await render(true);
    await render(false);
    await act(async () => host.querySelector<HTMLButtonElement>("#action")!.click());
    expect(action).toHaveBeenCalledTimes(1);
    expect(mocks.notice).not.toHaveBeenCalled();
  });
});
