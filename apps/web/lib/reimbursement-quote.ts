import { createHash } from "node:crypto";
import { SignJWT, jwtVerify } from "jose";
import { parseTokenAmount, formatTokenAmount } from "@allocard/delegation-sdk";
import { sessionSecret } from "./session-secret";
import { z } from "zod";

export const receiptDigest = (base64: string) => createHash("sha256").update(Buffer.from(base64.replace(/^data:[^,]*,/, ""), "base64")).digest("hex");
const quoteSchema = z.object({ receiptHash: z.string().regex(/^[0-9a-f]{64}$/), amountNear: z.string(), originalAmount: z.string(), currency: z.enum(["USD", "NEAR"]), sub: z.string() });
export async function createReceiptQuote(input: { receiptHash: string; originalAmount: string; currency: string; providerUserId: string }) {
  const currency = input.currency.toUpperCase();
  if (currency !== "NEAR" && currency !== "USD") throw new Error("This receipt currency is not supported. A verified conversion quote is required.");
  let amount: string;
  if (currency === "NEAR") amount = parseTokenAmount(input.originalAmount, 24);
  else {
    const response = await fetch("https://api.coinbase.com/v2/prices/NEAR-USD/spot", { cache: "no-store", signal: AbortSignal.timeout(15_000) });
    const result = await response.json();
    if (!response.ok || result.data?.base !== "NEAR" || result.data?.currency !== "USD" || typeof result.data?.amount !== "string") throw new Error("A current NEAR/USD quote is unavailable. Try again later.");
    const price = BigInt(parseTokenAmount(result.data.amount, 18));
    if (price <= 0n) throw new Error("Invalid NEAR/USD quote");
    amount = (BigInt(parseTokenAmount(input.originalAmount, 18)) * 10n ** 24n / price).toString();
  }
  if (BigInt(amount) <= 0n || BigInt(amount) > (1n << 128n) - 1n) throw new Error("Receipt total must be greater than zero");
  const amountNear = formatTokenAmount(amount, 24);
  const quote = await new SignJWT({ receiptHash: input.receiptHash, amountNear, originalAmount: input.originalAmount, currency })
    .setProtectedHeader({ alg: "HS256" }).setSubject(input.providerUserId).setAudience("allocard-reimbursement-quote").setIssuedAt().setExpirationTime("5m").sign(sessionSecret());
  return { quote, amountNear, currency, originalAmount: input.originalAmount, expiresAt: new Date(Date.now() + 300_000).toISOString() };
}
export async function verifyReceiptQuote(quote: string, receiptHash: string, providerUserId: string) {
  const { payload } = await jwtVerify(quote, sessionSecret(), { algorithms: ["HS256"], audience: "allocard-reimbursement-quote", subject: providerUserId });
  const parsed = quoteSchema.parse(payload);
  if (parsed.receiptHash !== receiptHash || BigInt(parseTokenAmount(parsed.amountNear, 24)) <= 0n) throw new Error("Receipt does not match its conversion quote");
  return parsed;
}
