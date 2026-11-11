// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
vi.mock("@/hooks/use-account-queries", () => ({ useAccountScope: () => ({ key: ["test", "owner"] }) }));
import { EmailTooltipLabel } from "@/components/email-tooltip-label";
import { DelegationCardsView } from "@/components/delegation-cards-view";
import { formatShortenedEmail, getEmployeeDisplayIdentity } from "@/lib/wallet";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("employee shortened email identity", () => {
  it("shortens verified email to local part with length cap and keeps full email", () => {
    expect(formatShortenedEmail("sarah.chen@enterprise-corp.io")).toBe("sarah.chen");
    expect(formatShortenedEmail("christopher.alejandro@enterprise-corp.io")).toBe("christopher.aleja…");

    expect(
      getEmployeeDisplayIdentity({
        verifiedEmail: "  christopher.alejandro@enterprise-corp.io  ",
        walletAddress: "emp1.testnet",
      }),
    ).toEqual({
      label: "christopher.aleja…",
      fullEmail: "christopher.alejandro@enterprise-corp.io",
    });

    expect(
      getEmployeeDisplayIdentity({
        verifiedEmail: null,
        walletAddress: "emp1a2b3.testnet",
      }),
    ).toEqual({
      label: "EMP-STNET",
      fullEmail: null,
    });
  });

  it("shows full email on hover in EmailTooltipLabel", async () => {
    vi.useFakeTimers();
    const prevResizeObserver = globalThis.ResizeObserver;
    globalThis.ResizeObserver = class {
      observe() {}
      unobserve() {}
      disconnect() {}
    };
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <EmailTooltipLabel
            label="christopher.aleja…"
            fullEmail="christopher.alejandro@enterprise-corp.io"
          />,
        ),
      );
      const trigger = host.querySelector<HTMLElement>("[data-full-email]");
      expect(trigger?.textContent).toBe("christopher.aleja…");
      expect(trigger?.getAttribute("data-full-email")).toBe("christopher.alejandro@enterprise-corp.io");

      await act(async () => {
        const PointerEv = globalThis.PointerEvent ?? MouseEvent;
        trigger?.dispatchEvent(new PointerEv("pointermove", { bubbles: true, pointerType: "mouse" } as PointerEventInit));
        vi.advanceTimersByTime(300);
      });
      const tooltip = document.querySelector('[role="tooltip"]');
      expect(tooltip?.textContent).toContain("christopher.alejandro@enterprise-corp.io");
    } finally {
      vi.useRealTimers();
      await act(async () => root.unmount());
      host.remove();
      globalThis.ResizeObserver = prevResizeObserver;
    }
  });

  it("displays shortened emails and allows searching by full email in DelegationCardsView", async () => {
    const host = document.createElement("div");
    document.body.append(host);
    const root = createRoot(host);
    try {
      await act(async () =>
        root.render(
          <DelegationCardsView
            company={{ id: "company", name: "Acme", smartAccountAddress: null }}
            employees={[
              {
                id: "emp-1",
                label: "christopher.aleja…",
                fullEmail: "christopher.alejandro@enterprise-corp.io",
                smartAccountAddress: null,
              },
            ]}
            delegations={[
              {
                id: "del-1",
                parentDelegationId: null,
                delegatorType: "company",
                delegatorId: "company",
                delegateeType: "user",
                delegateeId: "emp-1",
                status: "active",
                canvasPositionX: 0,
                canvasPositionY: 0,
                allowance: "25",
              },
            ]}
            viewMode="cards"
            onViewModeChange={() => {}}
          />,
        ),
      );

      expect(host.querySelector('[data-delegation-id="del-1"]')?.textContent).toContain("christopher.aleja…");
      expect(host.querySelector('[data-full-email="christopher.alejandro@enterprise-corp.io"]')).not.toBeNull();

      const input = host.querySelector<HTMLInputElement>('input[aria-label="Search delegations"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "enterprise-corp.io");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      expect(host.querySelectorAll("tr[data-delegation-id]")).toHaveLength(1);
    } finally {
      await act(async () => root.unmount());
      host.remove();
    }
  });
});
