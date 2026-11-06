import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), enabled: vi.fn(), prepare: vi.fn(), submit: vi.fn() }));
vi.mock("@/lib/session", () => ({ getSessionIdentity: mocks.session }));
vi.mock("@/lib/near-sponsor-server", () => ({
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
