import { beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ owner: vi.fn(), tasks: vi.fn(), user: vi.fn() }));
vi.mock("@/lib/db", () => ({ db: { select: () => ({ from: () => ({ where: () => ({ limit: mocks.owner }) }) }) } }));
vi.mock("@/lib/auth-guard", () => ({ requireSessionUser: mocks.user, requireEmployeeCompany: vi.fn() }));
vi.mock("@/lib/agent-adapter/store", () => ({ companyTasks: mocks.tasks, viewTask: (value: unknown) => value }));
vi.mock("@/lib/agent-adapter/permissions", () => ({ authorizeAdapter: vi.fn() }));
vi.mock("@/lib/agent-adapter/service", () => ({ progressTask: vi.fn(), cancelQueued: vi.fn() }));
vi.mock("@/lib/agent-adapter/worker", () => ({ workerReady: vi.fn() }));
vi.mock("@/lib/agent-adapter/catalog", () => ({ discoverWorkers: vi.fn() }));
import { GET } from "@/app/api/agent-adapter/route";
const companyId = "22222222-2222-4222-8222-222222222222";
const delegationId = "33333333-3333-4333-8333-333333333333";
const request = (id = delegationId) => new Request(`http://localhost/api/agent-adapter?companyId=${companyId}&view=company&delegationId=${id}`);
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: "owner" }); mocks.owner.mockResolvedValue([{ id: companyId }]); mocks.tasks.mockResolvedValue([]); });
it("passes the exact delegation scope to the company-owned task query", async () => {
  expect((await GET(request())).status).toBe(200);
  expect(mocks.tasks).toHaveBeenCalledWith(companyId, delegationId);
});
it("denies company activity to non-owners before reading tasks", async () => {
  mocks.owner.mockResolvedValue([]);
  expect((await GET(request())).status).toBe(403);
  expect(mocks.tasks).not.toHaveBeenCalled();
});
it("rejects an invalid delegation filter", async () => {
  expect((await GET(request("invalid"))).status).toBe(400);
  expect(mocks.tasks).not.toHaveBeenCalled();
});
