import { describe, it, expect } from "vitest";
import type { User } from "@privy-io/node";
import { verifiedPrivyAccount } from "@/lib/privy-server";
const address = "ab".repeat(32);
function user(accounts: unknown[]) { return { id: "did:privy:test", linked_accounts: accounts } as unknown as User; }
const wallet = { type: "wallet", chain_type: "near", wallet_client_type: "privy", address };
describe("verified email and NEAR wallet binding", () => {
  it("uses only the server-returned linked wallet and email", () => {
    expect(verifiedPrivyAccount(user([wallet, { type: "email", address: "Alice@Example.com" }]), address)).toEqual({ providerUserId: "did:privy:test", walletAddress: address, email: "alice@example.com" });
  });
  it("rejects an unlinked or external wallet", () => {
    expect(() => verifiedPrivyAccount(user([{ ...wallet, wallet_client_type: "external" }, { type: "email", address: "a@example.com" }]), address)).toThrow("not linked");
  });
  it("requires a real email rather than constructing one from a wallet", () => {
    expect(() => verifiedPrivyAccount(user([wallet]), address)).toThrow("verified email");
  });
});
