import { afterEach, describe, expect, it, vi } from "vitest";
import { createReceiptQuote, receiptDigest, verifyReceiptQuote } from "@/lib/reimbursement-quote";
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
const hash = "a".repeat(64), user = "did:privy:test";
describe("receipt-bound native NEAR quotes", () => {
  it("converts USD with integer arithmetic using a verified price", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ data: { base: "NEAR", currency: "USD", amount: "2.5" } })));
    const quote = await createReceiptQuote({ receiptHash: hash, originalAmount: "100", currency: "USD", providerUserId: user });
    expect(quote.amountNear).toBe("40");
    expect((await verifyReceiptQuote(quote.quote, hash, user)).amountNear).toBe("40");
    await expect(verifyReceiptQuote(quote.quote, "b".repeat(64), user)).rejects.toThrow();
    await expect(verifyReceiptQuote(quote.quote, hash, "did:privy:other")).rejects.toThrow();
  });
  it("never treats USD as NEAR when the price service fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ error: "Unavailable" }, { status: 503 })));
    await expect(createReceiptQuote({ receiptHash: hash, originalAmount: "100", currency: "USD", providerUserId: user })).rejects.toThrow("unavailable");
  });
  it("preserves 24-decimal NEAR precision without fiat conversion", async () => {
    const quote = await createReceiptQuote({ receiptHash: hash, originalAmount: "0.000000000000000000000001", currency: "NEAR", providerUserId: user });
    expect(quote.amountNear).toBe("0.000000000000000000000001");
  });
  it("rejects expired quotes", async () => {
    vi.useFakeTimers();
    const quote = await createReceiptQuote({ receiptHash: hash, originalAmount: "1", currency: "NEAR", providerUserId: user });
    vi.setSystemTime(Date.now() + 301_000);
    await expect(verifyReceiptQuote(quote.quote, hash, user)).rejects.toThrow();
  });
  it("binds image bytes rather than trusting a data URI prefix", () => {
    expect(receiptDigest("data:image/png;base64,aGVsbG8=")).toBe(receiptDigest("aGVsbG8="));
  });
});
