// @vitest-environment jsdom
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/components/AuthProvider", () => ({ useAuth: () => ({ status: "connecting" }) }));
vi.mock("@/app/actions/identity", () => ({ getWalletProfile: vi.fn(), getWorkspaceOptions: vi.fn() }));
import { DashboardLoading } from "@/components/dashboard-loading";
import { SectionCards } from "@/components/section-cards";

function render(role: "employer" | "employee") {
  const client = new QueryClient();
  const html = renderToStaticMarkup(<QueryClientProvider client={client}><DashboardLoading role={role} /></QueryClientProvider>);
  client.clear();
  return new DOMParser().parseFromString(html, "text/html");
}
describe("dashboard loading shell", () => {
  it("keeps employer navigation, card labels and delegation structure visible", () => {
    const doc = render("employer");
    expect(doc.querySelector("header h1")?.textContent).toBe("Company dashboard");
    for (const label of ["Workspace", "Employees", "Treasury Balance", "Active Delegations", "Delegated NEAR", "Delegations", "Activity Log"]) expect(doc.body.textContent).toContain(label);
    expect(doc.body.textContent).not.toContain("No delegations yet");
    expect(doc.body.textContent).not.toContain("No active employees yet");
    expect(doc.querySelectorAll('[data-slot="skeleton"]').length).toBeGreaterThan(4);
    const add = [...doc.querySelectorAll("button")].find(button => button.textContent?.includes("Add delegation"));
    expect(add?.disabled).toBe(true);
  });
  it("keeps employee navigation and the actual spending form visible but disabled", () => {
    const doc = render("employee");
    expect(doc.querySelector("header h1")?.textContent).toBe("Employee dashboard");
    for (const label of ["Available Allowance", "Authorized Spending Limit", "Utilized Spend", "Direct Corporate Spend", "Recipient Account", "Amount (NEAR)"]) expect(doc.body.textContent).toContain(label);
    expect(doc.querySelector<HTMLInputElement>("#ds-to")?.disabled).toBe(true);
    expect(doc.querySelector<HTMLInputElement>("#ds-amount")?.disabled).toBe(true);
    expect([...doc.querySelectorAll("button")].find(button => button.textContent?.includes("Execute Spend"))?.disabled).toBe(true);
    expect(doc.body.textContent).not.toContain("Smart account not yet activated");
  });
  it("skeletonizes an unavailable treasury balance independently of known summary values", () => {
    const html = renderToStaticMarkup(<SectionCards employeeCount={7} activeDelegationCount={3} delegatedNativeNearAllowance="12" balanceLoading />);
    const doc = new DOMParser().parseFromString(html, "text/html");
    expect(doc.querySelectorAll('[data-slot="skeleton"]')).toHaveLength(1);
    expect(doc.body.textContent).toContain("7");
    expect(doc.body.textContent).toContain("12 NEAR");
  });
});
