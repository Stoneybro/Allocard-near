import { beforeEach, describe, expect, it, vi } from "vitest";
vi.mock("server-only",()=>({}));
const mocks=vi.hoisted(()=>({identity:vi.fn(),profile:vi.fn(),employee:vi.fn(),employer:vi.fn()}));
vi.mock("@/lib/session",()=>({getSessionIdentity:mocks.identity}));
vi.mock("@/app/actions/identity",()=>({getWalletProfile:mocks.profile,getEmployeeDashboardState:mocks.employee,getCompanyDashboardState:mocks.employer}));
import { GET } from "@/app/api/dashboard/route";
const request=(view="profile",wallet="alice.testnet")=>new Request(`https://allocard.test/api/dashboard?${new URLSearchParams({view,wallet})}`);
beforeEach(()=>{vi.clearAllMocks();mocks.identity.mockResolvedValue({walletAddress:"alice.testnet"});});
describe("independent authenticated dashboard reads",()=>{
 it("requires a session before reading any profile",async()=>{mocks.identity.mockResolvedValue(null);expect((await GET(request())).status).toBe(401);expect(mocks.profile).not.toHaveBeenCalled();});
 it("rejects another wallet even with a valid session",async()=>{expect((await GET(request("profile","bob.testnet"))).status).toBe(403);expect(mocks.profile).not.toHaveBeenCalled();});
 it("returns only the session wallet's profile",async()=>{mocks.profile.mockResolvedValue({status:"employee"});const response=await GET(request());expect(await response.json()).toEqual({status:"employee"});expect(mocks.profile).toHaveBeenCalledWith("alice.testnet");expect(response.headers.get("cache-control")).toContain("no-store");});
 it("dispatches employee reads through the employee authorization function",async()=>{mocks.employee.mockResolvedValue({company:{id:"company"}});expect((await GET(request("employee"))).status).toBe(200);expect(mocks.employee).toHaveBeenCalledWith("alice.testnet");expect(mocks.employer).not.toHaveBeenCalled();});
});
