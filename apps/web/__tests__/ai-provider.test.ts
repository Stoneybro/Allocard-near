import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { aiChat, getApiKey, getBaseUrl } from "@/lib/ai";
beforeEach(() => {
  for (const key of ["NEAR_AI_API_KEY", "NEARAI_API_KEY", "DASHSCOPE_API_KEY", "NEAR_AI_BASE_URL", "NEARAI_BASE_URL"]) vi.stubEnv(key, "");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });
it("uses the Cloud endpoint with either supported NEAR key name and ignores empty shadow values", () => {
  vi.stubEnv("NEARAI_API_KEY", "test-key");
  expect(getApiKey()).toBe("test-key");
  expect(getBaseUrl()).toBe("https://cloud-api.near.ai/v1");
});
it("does not expose provider response bodies in client-facing errors or logs", async () => {
  vi.stubEnv("NEAR_AI_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async () => new Response("sensitive provider diagnostic", { status: 401 })));
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  await expect(aiChat({ messages: [] })).rejects.toThrow("HTTP 401");
  expect(JSON.stringify(error.mock.calls)).not.toContain("sensitive provider diagnostic");
});
