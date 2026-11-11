import { afterEach, expect, it, vi } from "vitest";
import { dashboardRead } from "@/lib/dashboard-read";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it("honors a provider cooldown across refocus/refresh while keeping identities separate", async () => {
  vi.useFakeTimers(); vi.setSystemTime(100_000);
  const fetcher=vi.fn().mockResolvedValueOnce(Response.json({error:"Connection recovering"},{status:429,headers:{"Retry-After":"60"}})).mockImplementation(async () => Response.json({ok:true}));
  vi.stubGlobal("fetch",fetcher);
  await expect(dashboardRead("employee","limited-wallet")).rejects.toThrow("Connection recovering");
  await expect(dashboardRead("employee","limited-wallet")).rejects.toThrow("Connection recovering");
  expect(fetcher).toHaveBeenCalledTimes(1);
  await dashboardRead("employee","other-wallet"); expect(fetcher).toHaveBeenCalledTimes(2);
  vi.setSystemTime(160_001);
  await dashboardRead("employee","limited-wallet"); expect(fetcher).toHaveBeenCalledTimes(3);
});
it("turns raw signal timeouts into a readable message without fabricating a snapshot", async () => {
  vi.stubGlobal("fetch",vi.fn().mockRejectedValue(new DOMException("signal timed out","TimeoutError")));
  await expect(dashboardRead("employee","slow-wallet")).rejects.toThrow("Live data is taking too long");
});
