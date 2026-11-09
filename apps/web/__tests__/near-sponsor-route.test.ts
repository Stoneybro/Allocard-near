import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), prepare: vi.fn(), submit: vi.fn(), companyEnabled: vi.fn(), companyPrepare: vi.fn(), companySubmit: vi.fn(), adapterPrepare: vi.fn(), adapterSubmit: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSessionIdentity: mocks.session }));
vi.mock("@/lib/near-sponsor-server", () => ({
  prepareSponsoredAdapter: mocks.adapterPrepare, submitSponsoredAdapter: mocks.adapterSubmit,
  companySponsorshipEnabled: mocks.companyEnabled, prepareSponsoredCompany: mocks.companyPrepare, submitSponsoredCompany: mocks.companySubmit,
  sponsoredCompanySchema: { safeParse: () => ({ success: true }), parse: (value: unknown) => value },
  sponsoredCompanyProofSchema: { safeParse: () => ({ success: true }), parse: (value: unknown) => value },
  sponsorshipEnabled: mocks.enabled, prepareSponsoredPayment: mocks.prepare, submitSponsoredPayment: mocks.submit,
  sponsoredPaymentSchema: { safeParse: () => ({ success: true }), parse: (value: unknown) => value },
  sponsoredProofSchema: { safeParse: () => ({ success: true }), parse: (value: unknown) => value },
}));
import { POST } from "@/app/api/near/sponsor/route";
function request(body: unknown, origin = "https://allocard.example") {
  return new Request("https://allocard.example/api/near/sponsor", { method: "POST", headers: { origin, "Content-Type": "application/json" }, body: JSON.stringify(body) });
}
beforeEach(() => { vi.resetAllMocks(); mocks.session.mockResolvedValue({ walletAddress: "a".repeat(64) }); mocks.enabled.mockReturnValue(true); mocks.prepare.mockResolvedValue({ enabled: true, nonce: "2", maxBlockHeight: "220" }); });
describe("sponsorship API boundary", () => {
  it("rejects cross-origin and unauthenticated requests before sponsoring", async () => {
    expect((await POST(request({ operation: "prepare" }, "https://attacker.example"))).status).toBe(403);
    mocks.session.mockResolvedValue(null);
    expect((await POST(request({ operation: "prepare" }))).status).toBe(401);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("leaves direct signing available when sponsorship is disabled", async () => {
    mocks.enabled.mockReturnValue(false);
    const response = await POST(request({ operation: "prepare" }));
    expect(await response.json()).toEqual({ enabled: false });
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("requires the separate company-deposit opt-in", async () => {
    mocks.companyEnabled.mockReturnValue(false);
    const response = await POST(request({ operation: "prepare-company" }));
    expect(await response.json()).toEqual({ enabled: false }); expect(mocks.companyPrepare).not.toHaveBeenCalled();
    mocks.companyEnabled.mockReturnValue(true); mocks.companyPrepare.mockResolvedValue({ enabled: true, nonce: "2" });
    const enabled = await POST(request({ operation: "prepare-company" }));
    expect(await enabled.json()).toEqual({ enabled: true, nonce: "2" });
  });
  it("rejects oversized requests", async () => {
    expect((await POST(request({ operation: "prepare", padding: "a".repeat(8192) }))).status).toBe(413);
    expect(mocks.prepare).not.toHaveBeenCalled();
  });
  it("never exposes database SQL and parameters through sponsorship errors", async () => {
    mocks.prepare.mockRejectedValue(new Error("Failed query: private SQL params: secret"));
    const response = await POST(request({ operation: "prepare" }));
    expect(response.status).toBe(503);
    expect(JSON.stringify(await response.json())).not.toContain("secret");
  });
});

it("routes only strictly validated adapter permission requests to the sponsor",async()=>{
 const permission={treasury:"shared.testnet",delegationId:"11111111-1111-4111-8111-111111111111",parentId:"7",spec:{delegate:"adapter.testnet",valid_from_ms:"0",redelegation_depth:0,rules:[{asset:{type:"NativeNear"},recipients:{type:"Any"},lifetime_limit:"10",acknowledge_unbounded_budget:false}]}};
 mocks.adapterPrepare.mockResolvedValue({enabled:true,nonce:"2",maxBlockHeight:"220"});
 const response=await POST(request({operation:"prepare-adapter",...permission}));
 expect(response.status).toBe(200);expect(mocks.adapterPrepare).toHaveBeenCalledWith(permission);
 mocks.adapterPrepare.mockClear();
 expect((await POST(request({operation:"prepare-adapter",...permission,deposit:"1"}))).status).toBe(400);
 expect(mocks.adapterPrepare).not.toHaveBeenCalled();
});
