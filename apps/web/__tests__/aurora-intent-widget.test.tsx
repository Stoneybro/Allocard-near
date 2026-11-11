// @vitest-environment jsdom
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, expect, it, vi } from "vitest";

vi.mock("next-themes", () => ({ useTheme: () => ({ resolvedTheme: "light" }) }));
vi.mock("@aurora-is-near/intents-swap-widget/styles.css", () => ({}));
vi.mock("@aurora-is-near/intents-swap-widget-standalone", () => ({
  WidgetConfigProvider: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  Widget: () => <div>Swap interface</div>,
}));
import AuroraIntentWidget from "@/components/aurora-intent-widget";

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

it.each(["http", "missing-key", "network"])("recovers from a %s configuration failure on retry", async (failure) => {
  vi.stubEnv("NEXT_PUBLIC_AURORA_INTENTS_API_KEY", "");
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  const fetchMock = vi.fn();
  if (failure === "network") fetchMock.mockRejectedValueOnce(new Error("offline"));
  else fetchMock.mockResolvedValueOnce(failure === "http" ? new Response(null, { status: 503 }) : Response.json({ apiKey: "" }));
  fetchMock.mockResolvedValueOnce(Response.json({ apiKey: "widget-key", environment: "production" }));
  vi.stubGlobal("fetch", fetchMock);
  const host = document.createElement("div");
  const root = createRoot(host);
  try {
    await act(async () => root.render(<AuroraIntentWidget destinationNearAddress="treasury.testnet" />));
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("couldn’t load");
    await act(async () => host.querySelector<HTMLButtonElement>("button")!.click());
    expect(host.textContent).toContain("Swap interface");
    expect(host.querySelector('[role="alert"]')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  } finally {
    await act(async () => root.unmount());
  }
});
