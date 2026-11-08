import { describe, expect, it } from "vitest";
import { parseUserOpError } from "@/lib/error-parser";
describe("transaction error messages", () => {
  it("preserves the full relayer configuration error without calling it a policy decline", () => {
    const message = "The configured relayer signing key is not registered on allocardfactory.testnet. Set NEAR_RELAYER_PRIVATE_KEY to a registered regular FullAccess key for that account.";
    expect(parseUserOpError(new Error(message))).toBe(message);
  });
  it("distinguishes relayer balance errors from company treasury balance errors", () => {
    expect(parseUserOpError(new Error("Relayer has insufficient balance"))).toBe("Relayer has insufficient balance");
  });
  it("does not turn long unknown errors into company policy failures", () => {
    const message = "Database unavailable. ".repeat(12);
    expect(parseUserOpError(new Error(message))).toBe(message);
  });
  it("retains recognized spending policy explanations", () => {
    expect(parseUserOpError(new Error("TransferAmount exceeds limit"))).toContain("Lifetime spending limit exceeded");
  });
});
