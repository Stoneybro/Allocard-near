import { describe, expect, it, vi } from "vitest";
import { POST as faucet } from "@/app/api/faucet/seed/route";

describe("retired unsupported financial paths", () => {
  it("cannot sign, pay or claim fulfillment", async () => {
    const fetcher = vi.fn();
    vi.stubGlobal("fetch", fetcher);
    try {
      const response = await faucet();
      expect(response.status).toBe(410);
      expect(await response.json()).toMatchObject({ code: "FEATURE_RETIRED" });
      expect(fetcher).not.toHaveBeenCalled();
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
