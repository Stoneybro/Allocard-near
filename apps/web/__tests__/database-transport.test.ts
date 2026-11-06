import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("node:https", () => ({ default: { request: mocks.request } }));
import { neonFetch } from "@/lib/db/transport.mjs";
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });
function request() {
  const req = Object.assign(new EventEmitter(), { write: vi.fn(), end: vi.fn(), destroy: vi.fn() });
  req.destroy.mockImplementation(error => { req.emit("error", error); return req; });
  mocks.request.mockReturnValue(req);
  return req;
}
describe("Neon transport", () => {
  it("times out a request even if the response body stalls", async () => {
    vi.useFakeTimers(); const req = request();
    const pending = neonFetch("https://database.example/sql", { method: "POST" });
    req.emit("response", new EventEmitter());
    const rejected = expect(pending).rejects.toMatchObject({ code: "ETIMEDOUT" });
    await vi.advanceTimersByTimeAsync(10_000); await rejected;
    expect(req.destroy).toHaveBeenCalledTimes(1);
  });
  it("rejects truncated responses instead of hanging", async () => {
    const req = request();
    const pending = neonFetch("https://database.example/sql");
    const res = new EventEmitter(); req.emit("response", res); res.emit("aborted");
    await expect(pending).rejects.toThrow("connection terminated");
  });
  it("preserves HTTP errors and headers for the Neon driver", async () => {
    const req = request();
    const pending = neonFetch("https://database.example/sql");
    const res = Object.assign(new EventEmitter(), { statusCode: 503, headers: { "content-type": "application/json" } });
    req.emit("response", res); res.emit("data", Buffer.from('{"error":"starting"}')); res.emit("end");
    const response = await pending;
    expect(response.status).toBe(503); expect(await response.json()).toEqual({ error: "starting" });
  });
});
