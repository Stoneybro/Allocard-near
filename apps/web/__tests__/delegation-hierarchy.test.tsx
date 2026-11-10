// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-account-queries", () => ({ useAccountScope: () => ({ key: ["test", "owner"] }) }));
import { DelegationCardsView } from "../components/delegation-cards-view";
import type { DelegationCanvasDelegation } from "../components/dashboard-flow-canvas";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const revoke = vi.fn();
const delegation = (id: string, parentDelegationId: string | null, delegateeId: string, delegatorType: "company" | "user" | "agent" = "company"): DelegationCanvasDelegation => ({
  id, parentDelegationId, delegateeId, delegatorType, delegatorId: "issuer",
  delegateeType: id === "employee" ? "user" : "agent", status: "active",
  canvasPositionX: 0, canvasPositionY: 0, allowance: "10",
});
function view(delegations: DelegationCanvasDelegation[]) {
  return (<DelegationCardsView
    company={{ id: "company", name: "Acme", smartAccountAddress: null }}
    employees={[{ id: "person", label: "Alex", smartAccountAddress: null }]}
    agents={[{ id: "assistant", name: "Assistant", smartAccountAddress: null }, { id: "worker", name: "Worker", smartAccountAddress: null }]}
    delegations={delegations} viewMode="cards" onViewModeChange={() => {}}
    onConfigureDelegation={() => {}} onRevokeDelegation={revoke}
  />);
}

function render(delegations: DelegationCanvasDelegation[]) { return renderToStaticMarkup(view(delegations)); }

describe("delegation hierarchy", () => {
  it("opens multiple generations and allows child revocation without child rule editing", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(view([
        delegation("employee", null, "person"),
        delegation("assistant", "employee", "assistant", "user"),
        delegation("worker", "assistant", "worker", "agent"),
      ])));
      expect(container.querySelectorAll("tr[data-delegation-id]")).toHaveLength(3);
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse details for Assistant"]')!.click());
      expect(container.querySelectorAll("tr[data-delegation-id]")).toHaveLength(2);
      expect(container.querySelector('[data-delegation-id="assistant"]')?.textContent).toContain("Alex");
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Expand details for Assistant"]')!.click());
      expect(container.querySelectorAll("tr[data-delegation-id]")).toHaveLength(3);
      expect(container.querySelector('[data-delegation-id="worker"]')?.textContent).toContain("Assistant");
      expect(container.querySelectorAll('button[aria-label^="Revoke delegation"]')).toHaveLength(3);
      expect(container.querySelectorAll('button[aria-label^="View rules for"]')).toHaveLength(1);
      expect([...container.querySelectorAll("th")].map(cell => cell.textContent)).not.toContain("Status");
      revoke.mockClear();
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Revoke delegation for Assistant"]')!.click());
      expect(revoke).not.toHaveBeenCalled();
      expect(document.querySelector('[role="alertdialog"]')?.textContent).toContain("employee’s own delegation");
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Cancel")!.click());
      expect(revoke).not.toHaveBeenCalled();
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Revoke delegation for Assistant"]')!.click());
      await act(async () => [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')].find(button => button.textContent === "Revoke delegation")!.click());
      expect(revoke).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith("assistant");
      expect(container.querySelector('[data-delegation-id="employee"]')).not.toBeNull();
      await act(async () => container.querySelector<HTMLButtonElement>('button[aria-label="Collapse details for Alex"]')!.click());
      expect(container.querySelectorAll("tr[data-delegation-id]")).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
  it("reveals matching descendants with their parent context during search", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    try {
      await act(async () => root.render(view([
        delegation("employee", null, "person"),
        delegation("assistant", "employee", "assistant", "user"),
        delegation("worker", "assistant", "worker", "agent"),
      ])));
      const input = container.querySelector<HTMLInputElement>('input[aria-label="Search delegations"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "Worker");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(container.querySelectorAll("tr[data-delegation-id]")).toHaveLength(3);
      expect(container.querySelector('[data-delegation-id="worker"]')?.textContent).toContain("Worker");
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "unknown-person");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(container.textContent).toContain("No matching delegations");
    } finally {
      await act(async () => root.unmount());
      container.remove();
    }
  });
  it("keeps a delegation visible when its parent is absent from the supplied view", () => {
    expect(render([delegation("assistant", "missing", "assistant", "user")])).toContain("Assistant");
  });
  it("hides revoked employees and their revoked descendants", () => {
    const html = render([
      { ...delegation("employee", null, "person"), status: "revoked" },
      { ...delegation("assistant", "employee", "assistant", "user"), status: "revoked" },
    ]);
    const tree = new DOMParser().parseFromString(html, "text/html");
    expect(tree.querySelectorAll("tr[data-delegation-id]")).toHaveLength(0);
    expect(html).toContain("No delegations yet");
    expect(html).not.toContain("Spending disabled");
  });
  it("keeps a new delegation visible for a previously revoked employee", () => {
    const html = render([
      { ...delegation("old-employee", null, "person"), delegateeType: "user", status: "revoked" },
      delegation("employee", null, "person"),
    ]);
    const tree = new DOMParser().parseFromString(html, "text/html");
    expect(tree.querySelectorAll('tr[data-delegation-id]')).toHaveLength(1);
    expect(tree.querySelector('table[aria-label="Delegations from Acme"]')?.textContent).toContain("Alex");
    expect(tree.querySelectorAll('button[aria-label^="Revoke delegation"]')).toHaveLength(1);
  });
  it("shows an empty state without presenting an unknown balance as zero", () => {
    const html = render([]);
    expect(html).toContain("No delegations yet");
    expect(html).not.toContain("0.00");
  });
});
