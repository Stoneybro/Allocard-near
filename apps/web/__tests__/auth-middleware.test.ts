import { afterEach, describe, expect, it, vi } from "vitest";
import { SignJWT } from "jose";
import { NextRequest } from "next/server";
import { middleware } from "@/middleware";
const secret = "s".repeat(32);
afterEach(() => vi.unstubAllEnvs());
async function request(version?: number) {
  const token = await new SignJWT({ walletAddress: "alice.testnet", ...(version ? { authVersion: version } : {}) })
    .setProtectedHeader({ alg: "HS256" }).setSubject("near:alice.testnet").setExpirationTime("1h").sign(new TextEncoder().encode(secret));
  return new NextRequest("https://allocard.example/employee", { headers: { cookie: `allocard_session=${token}` } });
}
describe("navigation session guard", () => {
  it("lets server guards validate development sessions without a configured secret", async () => {
    vi.stubEnv("NODE_ENV", "development"); vi.stubEnv("SESSION_SECRET", "");
    const response = await middleware(new NextRequest("http://localhost:3000/employee"));
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });
  it("does not bypass production authentication without a secret", async () => {
    vi.stubEnv("NODE_ENV", "production"); vi.stubEnv("SESSION_SECRET", "");
    expect((await middleware(new NextRequest("https://allocard.example/employee"))).status).toBe(307);
  });
  it("rejects legacy session cookies", async () => {
    vi.stubEnv("SESSION_SECRET", secret);
    expect((await middleware(await request())).status).toBe(307);
  });
  it("accepts current verified sessions", async () => {
    vi.stubEnv("SESSION_SECRET", secret);
    expect((await middleware(await request(2))).headers.get("x-middleware-next")).toBe("1");
  });
});
