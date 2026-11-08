import { z } from "zod";
import { getSessionIdentity } from "@/lib/session";
import { extractReceiptData } from "@/lib/ai";
import { createReceiptQuote, receiptDigest } from "@/lib/reimbursement-quote";
export async function POST(request: Request) {
  const identity = await getSessionIdentity();
  if (!identity) return Response.json({ error: "Sign in again to continue" }, { status: 401 });
  const parsed = z.object({ receiptBase64: z.string().min(1).max(12_000_000) }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Provide a receipt image" }, { status: 400 });
  try {
    const extraction = z.object({ merchant: z.string(), date: z.string(), totalAmount: z.string().regex(/^\d+(\.\d{1,24})?$/), currency: z.string(), suggestedPurpose: z.string(), lineItems: z.array(z.string()), confidence: z.number().min(0.8).max(1) }).parse(await extractReceiptData({ imageBase64: parsed.data.receiptBase64 }));
    const quote = await createReceiptQuote({ receiptHash: receiptDigest(parsed.data.receiptBase64), originalAmount: extraction.totalAmount, currency: extraction.currency, providerUserId: identity.providerUserId });
    return Response.json({ extraction, ...quote });
  } catch { return Response.json({ error: "Receipt extraction or its currency quote is unavailable. Try again with a clear USD or NEAR receipt." }, { status: 503 }); }
}
