import { afterEach, describe, expect, it, vi } from "vitest";
import { withRetry } from "@/lib/db/withRetry";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
describe("Neon recovery", () => {
  it("recovers from compute startup SQLSTATE failures", async () => {
    vi.useFakeTimers(); vi.spyOn(console, "warn").mockImplementation(() => {});
    const operation = vi.fn().mockRejectedValueOnce(new Error("Failed query: private", { cause: Object.assign(new Error("starting up"), { code: "57P03" }) })).mockResolvedValue("ready");
    const result = withRetry(operation);
    await vi.runAllTimersAsync();
    expect(await result).toBe("ready");
    expect(operation).toHaveBeenCalledTimes(2);
    expect(vi.mocked(console.warn).mock.calls.flat().join(" ")).not.toContain("private");
  });
  it("does not retry SQL errors containing connection words in query parameters", async () => {
    const operation = vi.fn().mockRejectedValue(new Error("Failed query: select connection timeout", { cause: Object.assign(new Error("column missing"), { code: "42703" }) }));
    await expect(withRetry(operation)).rejects.toThrow("Failed query");
    expect(operation).toHaveBeenCalledTimes(1);
  });
  it("bounds repeated network failures to four attempts", async () => {
    vi.useFakeTimers(); vi.spyOn(console, "warn").mockImplementation(() => {});
    const operation = vi.fn().mockRejectedValue(new Error("fetch failed"));
    const result = expect(withRetry(operation)).rejects.toThrow("fetch failed");
    await vi.runAllTimersAsync(); await result;
    expect(operation).toHaveBeenCalledTimes(4);
  });
});
