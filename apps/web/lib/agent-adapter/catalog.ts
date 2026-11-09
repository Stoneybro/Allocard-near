import "server-only";
import { z } from "zod";
import type { Candidate } from "./shared";
const rows = z.object({ agents: z.array(z.object({ agentId: z.string().optional(), agent_id: z.string().optional(), id: z.string().optional(), name: z.string(), handle: z.string().nullable().optional(), description: z.string().nullable().optional(), tagline: z.string().nullable().optional(), price: z.union([z.string(),z.number()]).nullable().optional() }).passthrough()).max(50) });
export async function discoverWorkers(query: string): Promise<Candidate[]> {
  const url = new URL("https://market.near.ai/v1/agents"); url.searchParams.set("q", query.slice(0,200)); url.searchParams.set("limit", "6");
  const response = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(12000), redirect: "error" });
  if (!response.ok) throw new Error("Marketplace discovery is unavailable. The direct demo worker remains available.");
  const result = rows.parse(await response.json());
  return result.agents.map(agent => ({ id: agent.agentId ?? agent.agent_id ?? agent.id ?? agent.name, name: agent.name.slice(0,150), description: (agent.tagline ?? agent.description ?? "").slice(0,500), handle: agent.handle ?? null, price: agent.price == null ? null : String(agent.price), url: agent.handle && /^[a-z0-9_-]+$/.test(agent.handle) ? `https://${agent.handle}.market.near.ai` : "https://market.near.ai" }));
}
