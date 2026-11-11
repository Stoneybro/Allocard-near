import { afterEach, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { discoverWorkers } from "@/lib/agent-adapter/catalog";
import { WORKER_HANDLE } from "@/lib/agent-adapter/shared";
afterEach(() => vi.unstubAllGlobals());
const research = { agent_id: "research", handle: WORKER_HANDLE, name: "Actual marketplace name", description: "Live description" };
it("pins the exact live research listing ahead of task matches and deduplicates it", async () => {
  vi.stubGlobal("fetch", vi.fn(async (url: URL) => Response.json({ agents: url.searchParams.get("q") === WORKER_HANDLE ? [research] : [{ agent_id: "other", name: "Other agent" }, research] })));
  const agents = await discoverWorkers("Compare team software");
  expect(agents.map(agent => agent.id)).toEqual(["research", "other"]);
  expect(agents[0].name).toBe("Actual marketplace name");
});
it("does not invent a marketplace listing when the research handle is absent", async () => {
  vi.stubGlobal("fetch", vi.fn(async () => Response.json({ agents: [{ agent_id: "other", name: "Other agent", handle: "other" }] })));
  expect((await discoverWorkers("research")).some(agent => agent.handle === WORKER_HANDLE)).toBe(false);
});
