import { describe, it, expect } from "vitest";
import { getUnifiedNearCaller } from "@/lib/near";
describe("Privy-only NEAR signing", () => {
  it("rejects unsigned transaction callers", async () => {
    await expect(getUnifiedNearCaller({ status: "authenticated", accountId: "a".repeat(64) })).rejects.toThrow("Sign in with Privy");
    await expect(getUnifiedNearCaller({ status: "unauthenticated" })).rejects.toThrow("Sign in with Privy");
  });
  it("uses the verified Privy caller", async () => {
    const caller = { viewFunction: async () => null, functionCall: async () => ({}) };
    expect(await getUnifiedNearCaller({ status: "authenticated", accountId: "a".repeat(64), authMethod: "privy", caller })).toBe(caller);
  });
});
