import { describe, expect, it, vi } from "vitest";
import { POST as faucet } from "@/app/api/faucet/seed/route";
import { POST as travel } from "@/app/api/agents/travel/book/route";
import { POST as procure } from "@/app/api/agents/procurement/book/route";
import { POST as devops } from "@/app/api/agents/devops/procure/route";
import { POST as remit } from "@/app/api/agents/agora/remit/route";
describe("retired unsupported financial paths", () => {
  it.each([faucet, travel, procure, devops, remit])("cannot sign, pay or claim fulfillment", async handler => {
    const fetcher = vi.fn(); vi.stubGlobal("fetch", fetcher);
    try { const response = await handler(); expect(response.status).toBe(410); expect(await response.json()).toMatchObject({ code: "FEATURE_RETIRED" }); expect(fetcher).not.toHaveBeenCalled(); }
    finally { vi.unstubAllGlobals(); }
  });
});
