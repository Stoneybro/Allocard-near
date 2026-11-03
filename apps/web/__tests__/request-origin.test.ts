import { describe, expect, it } from "vitest";
import { sameSiteOrigin } from "@/lib/request-origin";
function request(headers: Record<string, string>) {
  return new Request("http://localhost:3000/api/auth/session", { method: "POST", headers });
}
describe("authentication origin checks", () => {
  it("accepts direct local requests", () => {
    expect(sameSiteOrigin(request({ origin: "http://localhost:3000" }))).toBe("http://localhost:3000");
  });
  it("uses the forwarded public host behind an HTTPS proxy", () => {
    expect(sameSiteOrigin(request({ origin: "https://allocard.example", host: "localhost:3000", "x-forwarded-host": "allocard.example", "x-forwarded-proto": "https" }))).toBe("https://allocard.example");
  });
  it("uses Host when Next's internal URL differs", () => {
    expect(sameSiteOrigin(request({ origin: "https://allocard.example", host: "allocard.example" }))).toBe("https://allocard.example");
  });
  it("rejects another site even with forwarded headers", () => {
    expect(sameSiteOrigin(request({ origin: "https://attacker.example", "x-forwarded-host": "allocard.example" }))).toBeNull();
  });
  it("does not fall back to the internal host when a public host is forwarded", () => {
    expect(sameSiteOrigin(request({ origin: "http://localhost:3000", "x-forwarded-host": "allocard.example" }))).toBeNull();
  });
  it("rejects missing, opaque, malformed, and ambiguous origins", () => {
    for (const headers of [{}, { origin: "null" }, { origin: "https://allocard.example/path" }, { origin: "https://allocard.example", "x-forwarded-host": "allocard.example,attacker.example" }]) expect(sameSiteOrigin(request(headers as Record<string, string>))).toBeNull();
  });
  it("checks protocol and port when forwarded", () => {
    expect(sameSiteOrigin(request({ origin: "http://allocard.example", "x-forwarded-host": "allocard.example", "x-forwarded-proto": "https" }))).toBeNull();
    expect(sameSiteOrigin(request({ origin: "https://allocard.example:8443", "x-forwarded-host": "allocard.example" }))).toBeNull();
  });
});
