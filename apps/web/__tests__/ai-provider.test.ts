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
it("disables hosted DeepSeek thinking for policy extraction without changing other requests", async () => {
  vi.stubEnv("NEAR_AI_API_KEY", "test-key");
  vi.stubEnv("NEAR_AI_MODEL", "deepseek-ai/DeepSeek-V4.1-Flash-1017");
  const fetchMock = vi.fn<typeof fetch>(async () => Response.json({ choices: [{ finish_reason: "stop", message: { content: '{"confidence":0.95}' } }] }));
  vi.stubGlobal("fetch", fetchMock);
  await expect(aiChat({ messages: [], disableThinking: true })).resolves.toEqual({ confidence: 0.95 });
  expect(JSON.parse(fetchMock.mock.calls[0][1]!.body as string)).toMatchObject({ chat_template_kwargs: { enable_thinking: false }, response_format: { type: "json_object" } });
  await aiChat({ messages: [] });
  expect(JSON.parse(fetchMock.mock.calls[1][1]!.body as string)).not.toHaveProperty("chat_template_kwargs");
});
it("rejects token-truncated output even if the partial content is valid JSON", async () => {
  vi.stubEnv("NEAR_AI_API_KEY", "test-key");
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ choices: [{ finish_reason: "length", message: { content: '{"confidence":1}' } }] })));
  await expect(aiChat({ messages: [] })).rejects.toThrow("incomplete");
});
