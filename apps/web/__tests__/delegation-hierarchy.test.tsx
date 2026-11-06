// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DelegationCardsView } from "../components/delegation-cards-view";
import type { DelegationCanvasDelegation } from "../components/dashboard-flow-canvas";

const delegation = (id: string, parentDelegationId: string | null, delegateeId: string, delegatorType: "company" | "user" | "agent" = "company"): DelegationCanvasDelegation => ({
  id, parentDelegationId, delegateeId, delegatorType, delegatorId: "issuer",
  delegateeType: id === "employee" ? "user" : "agent", status: "active",
  canvasPositionX: 0, canvasPositionY: 0, allowance: "10",
});
function render(delegations: DelegationCanvasDelegation[]) {
  return renderToStaticMarkup(<DelegationCardsView
    company={{ id: "company", name: "Acme", smartAccountAddress: null }}
    employees={[{ id: "person", label: "Alex", smartAccountAddress: null }]}
    agents={[{ id: "assistant", name: "Assistant", smartAccountAddress: null }, { id: "worker", name: "Worker", smartAccountAddress: null }]}
    delegations={delegations} viewMode="cards" onViewModeChange={() => {}}
    onConfigureDelegation={() => {}} onRevokeDelegation={() => {}}
  />);
}

describe("delegation hierarchy", () => {
  it("nests multiple generations and limits management actions to company-issued permissions", () => {
    const html = render([
      delegation("employee", null, "person"),
      delegation("assistant", "employee", "assistant", "user"),
      delegation("worker", "assistant", "worker", "agent"),
    ]);
    const tree = new DOMParser().parseFromString(html, "text/html");
    const employeeChildren = tree.querySelector('ul[aria-label="Delegated by Alex"]');
    expect(employeeChildren?.querySelector('ul[aria-label="Delegated by Assistant"]')?.textContent).toContain("Worker");
    expect(tree.querySelectorAll('button[aria-label^="View rules for"]')).toHaveLength(1);
    expect(tree.querySelectorAll('button[aria-label^="Revoke delegation"]')).toHaveLength(1);
    expect(html).toContain("—");
    expect(html).not.toContain("Issue Card");
  });
  it("keeps a delegation visible when its parent is absent from the supplied view", () => {
    expect(render([delegation("assistant", "missing", "assistant", "user")])).toContain("Assistant");
  });
  it("shows an empty state without presenting an unknown balance as zero", () => {
    const html = render([]);
    expect(html).toContain("No delegations yet");
    expect(html).not.toContain("0.00");
  });
});
