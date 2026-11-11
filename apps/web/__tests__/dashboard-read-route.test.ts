import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({identity:vi.fn(),profile:vi.fn(),employee:vi.fn(),employer:vi.fn()}));
vi.mock("@/lib/session",()=>({getSessionIdentity:mocks.identity}));
vi.mock("@/app/actions/identity",()=>({getWalletProfile:mocks.profile,getEmployeeDashboardState:mocks.employee,getCompanyDashboardState:mocks.employer}));
import { GET } from "@/app/api/dashboard/route";
import { NearReadError } from "@/lib/near-read-error";
const request=(view="profile",wallet="alice.testnet")=>new Request(`https://allocard.test/api/dashboard?${new URLSearchParams({view,wallet})}`);
beforeEach(()=>{vi.clearAllMocks();mocks.identity.mockResolvedValue({walletAddress:"alice.testnet"});});
describe("independent authenticated dashboard reads",()=>{
 it("returns a retry deadline without exposing provider details",async()=>{
  mocks.employee.mockRejectedValueOnce(new NearReadError("get_spending_snapshot","RATE_LIMITED","private upstream diagnostic",60_000));
  const response=await GET(request("employee"));
  expect(response.status).toBe(429);expect(response.headers.get("retry-after")).toBe("60");
  expect(await response.json()).toMatchObject({code:"RATE_LIMITED",error:expect.not.stringContaining("private upstream")});
 });
 it("requires a session before reading any profile",async()=>{mocks.identity.mockResolvedValue(null);expect((await GET(request())).status).toBe(401);expect(mocks.profile).not.toHaveBeenCalled();});
 it("rejects another wallet even with a valid session",async()=>{expect((await GET(request("profile","bob.testnet"))).status).toBe(403);expect(mocks.profile).not.toHaveBeenCalled();});
 it("returns only the session wallet's profile",async()=>{mocks.profile.mockResolvedValue({status:"employee"});const response=await GET(request());expect(await response.json()).toEqual({status:"employee"});expect(mocks.profile).toHaveBeenCalledWith("alice.testnet");expect(response.headers.get("cache-control")).toContain("no-store");});
 it("dispatches employee reads through the employee authorization function",async()=>{mocks.employee.mockResolvedValue({company:{id:"company"}});expect((await GET(request("employee"))).status).toBe(200);expect(mocks.employee).toHaveBeenCalledWith("alice.testnet");expect(mocks.employer).not.toHaveBeenCalled();});
});
