import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
const mocks = vi.hoisted(() => ({ execute: vi.fn(), after: vi.fn(), drain: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { execute: mocks.execute }, databaseIdentity: () => "test-db" }));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/agent-adapter/service", () => ({ drainQueue: mocks.drain }));
import { GET, POST } from "@/app/api/internal/agent-adapter/research/route";
const binding = { action: "claim", jobId: "00000000-0000-4000-8000-000000000001", digest: "a".repeat(64), sessionId: "session-a", callId: "call-a" };
const request = (body: unknown, authorized = true) => new Request("https://allocard.test/api/internal/agent-adapter/research", { method: "POST", headers: authorized ? { authorization: `Bearer ${"s".repeat(40)}` } : {}, body: JSON.stringify(body) });
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("ALLOCARD_AGENT_SECRET", "s".repeat(40)); });
describe("durable billable research authorization", () => {
 it("rejects unauthenticated workers before accessing jobs", async () => { expect((await POST(request(binding, false))).status).toBe(401); expect(mocks.execute).not.toHaveBeenCalled(); });
 it("returns the stored brief only for the original successful claim", async () => {
  mocks.execute.mockResolvedValueOnce({ rows: [{ job_id: binding.jobId }] }).mockResolvedValueOnce({ rows: [{ prompt: "Authoritative brief", session_id: binding.sessionId, call_id: binding.callId }] }).mockResolvedValueOnce({ rows: [] });
  expect(await (await POST(request(binding))).json()).toEqual({ claimed: true, cached: false, prompt: "Authoritative brief" });
 });
 it("refuses a replay while the original model call is outstanding", async () => {
  mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ prompt: "Brief", session_id: binding.sessionId, call_id: binding.callId }] });
  expect(await (await POST(request(binding))).json()).toEqual({ claimed: false, cached: false });
 });
 it("does not expose a report to a different session", async () => {
  mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ result: "Saved report", session_id: "other-session", call_id: binding.callId }] });
  expect((await POST(request(binding))).status).toBe(409);
 });
 it("lets the original call recover its saved report without another billable claim", async () => {
  mocks.execute.mockResolvedValueOnce({ rows: [] }).mockResolvedValueOnce({ rows: [{ result: "Saved report", session_id: binding.sessionId, call_id: binding.callId }] });
  expect(await (await POST(request(binding))).json()).toEqual({ cached: true, result: "Saved report" });
 });
});

it("verifies the authenticated worker callback against durable storage", async () => {
 mocks.execute.mockResolvedValueOnce({ rows: [{ value: 1 }] });
 const response = await GET(new Request("https://allocard.test/api/internal/agent-adapter/research", {headers:{authorization:`Bearer ${"s".repeat(40)}`}}));
 expect(await response.json()).toEqual({ready:true,protocol:"durable-direct-v1",databaseIdentity:"test-db"});
});
it("returns saved status without relying on a runtime session lookup", async () => {
 mocks.execute.mockResolvedValueOnce({ rows: [{ state:"running",claimed:true,session_id:"direct-job",result:null }] });
 const response = await POST(request({...binding,action:"status"}));
 expect(await response.json()).toMatchObject({state:"running",claimed:true});
});
it("acknowledges a report only after its task and original call are saved together", async () => {
 mocks.execute.mockResolvedValueOnce({ rows: [{ id: binding.jobId }] });
 const response = await POST(request({ ...binding, action: "complete", result: "Report https://example.com/pricing" }));
 expect(await response.json()).toEqual({ saved: true });
 expect(mocks.execute).toHaveBeenCalledTimes(1);
 expect(mocks.after).toHaveBeenCalledTimes(1);
});
it("does not acknowledge an unauthorized or conflicting report", async () => {
 mocks.execute.mockResolvedValueOnce({ rows: [] });
 const response = await POST(request({ ...binding, action: "complete", sessionId: "other-session", result: "Different report" }));
 expect(await response.json()).toEqual({ saved: false });
});
