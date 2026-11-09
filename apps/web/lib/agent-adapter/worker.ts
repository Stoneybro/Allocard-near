import "server-only";
import { z } from "zod";
import { workerConfig } from "./config";
import type { TaskRow } from "./store";
const state = z.object({ state: z.enum(["running", "delivered", "failed", "cancelled"]), result: z.string().max(100000).nullable().optional(), message: z.string().max(500).nullable().optional(), sessionId: z.string().max(300).optional() });
export async function workerRequest(path: string, body?: unknown) {
  const { origin, secret } = workerConfig();
  const headers: Record<string, string> = { authorization: `Bearer ${secret}`, "content-type": "application/json" };
  if (process.env.ALLOCARD_WORKER_BYPASS) headers["x-vercel-protection-bypass"] = process.env.ALLOCARD_WORKER_BYPASS;
  const response = await fetch(new URL(path, origin), { method: body ? "POST" : "GET", headers, body: body ? JSON.stringify(body) : undefined, redirect: "error", cache: "no-store", signal: AbortSignal.timeout(15000) });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(response.status === 429 ? "Research provider is busy; status will be checked again." : "The research worker is unavailable. Check deployment configuration.");
  return response.json();
}
export async function dispatchWorker(row: TaskRow) {
  const result = await workerRequest("/allocard/jobs", { id: row.id, digest: row.digest, prompt: row.prompt, deadline: Date.now()+180000 });
  if (!result) throw new Error("Deploy the authenticated Allocard channel to the agent project first.");
  return state.parse(result);
}
export async function readWorker(row: TaskRow) {
  const result = await workerRequest(`/allocard/jobs/${row.id}/${row.digest}`);
  return result ? state.parse(result) : null;
}
export async function workerReady() {
  const value = await workerRequest("/allocard/health");
  return z.object({ ready: z.literal(true), mode: z.literal("direct_vercel_demo") }).parse(value);
}
