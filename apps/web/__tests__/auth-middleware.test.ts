import { describe, expect, it } from "vitest";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
describe("navigation hints for opaque server sessions", () => {
  it.each([undefined, "old.jwt.cookie", "short"])("redirects malformed/missing cookies", token => {
    const request = new NextRequest("https://allocard.example/employee", { headers: token ? { cookie: `allocard_session=${token}` } : {} });
    expect(middleware(request).status).toBe(307);
  });
  it("allows server guards to validate a well-formed opaque token", () => {
    expect(middleware(new NextRequest("https://allocard.example/employer", { headers: { cookie: `allocard_session=${"a".repeat(43)}` } })).headers.get("x-middleware-next")).toBe("1");
  });
});
