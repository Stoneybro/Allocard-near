import { nearQuery } from "@/lib/near-server";
import { NearReadError } from "@/lib/near-read-error";
import { invalidateNearReadCache, backoffNearRead } from "@/lib/near-read-coordinator";
import { SignedTransaction } from "near-api-js/lib/transaction";
import { sameSiteOrigin } from "@/lib/request-origin";
import { getSessionIdentity } from "@/lib/session";
import { nearRpcServerUrl } from "@/lib/near-rpc-server";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store" };
const reads = new Set(["view_account", "view_access_key", "view_access_key_list", "call_function"]);
function error(message: string, status: number) { return Response.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message } }, { status, headers }); }
export async function POST(request: Request) {
  if (!sameSiteOrigin(request)) return error("Wrong origin", 403);
  const text = await request.text();
  if (text.length > 131072) return error("NEAR request is too large", 413);
  let body: any;
  try { body = JSON.parse(text); } catch { return error("Invalid NEAR request", 400); }
  if (!body || Array.isArray(body) || !["query", "block", "tx", "send_tx"].includes(body.method) || !body.params || typeof body.params !== "object" || Array.isArray(body.params)) return error("Unsupported NEAR request", 400);
  if (body.method === "query" && !reads.has(body.params.request_type)) return error("Unsupported NEAR query", 400);
  if (body.method === "query") {
    try {
      const result = await nearQuery(body.params, { rpcId: body.id, dedupe: true });
      return Response.json({ jsonrpc: "2.0", id: body.id ?? null, result }, { headers });
    } catch (caught) {
      return error(caught instanceof NearReadError ? caught.message : "NEAR read unavailable", caught instanceof NearReadError && caught.code === "RATE_LIMITED" ? 503 : 502);
    }
  }
  if (body.method === "send_tx") {
    const identity = await getSessionIdentity();
    if (!identity) return error("Sign in again before submitting a transaction", 401);
    try {
      if (typeof body.params.signed_tx_base64 !== "string") return error("Missing signed transaction", 400);
      const signed = SignedTransaction.decode(Buffer.from(body.params.signed_tx_base64, "base64"));
      if (signed.transaction.signerId !== identity.walletAddress) return error("Transaction signer does not match your session", 403);
    } catch { return error("Invalid signed NEAR transaction", 400); }
  }
  if (body.method === "send_tx") invalidateNearReadCache();
  // Retry transport failures only for reads. Never automatically resubmit a transaction.
  const attempts = body.method === "send_tx" ? 1 : 2;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(nearRpcServerUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ jsonrpc: "2.0", id: body.id ?? "allocard", method: body.method, params: body.params }), signal: AbortSignal.timeout(body.method === "send_tx" || body.method === "tx" ? 40000 : 15000) });
      if (response.status === 429 || response.status >= 500) {
        if (attempt + 1 < attempts && await backoffNearRead(nearRpcServerUrl(), response)) continue;
        return error(body.method === "send_tx" ? "Transaction submission is uncertain. Check its execution before retrying." : "NEAR RPC is temporarily unavailable or rate limited. Retry shortly.", 503);
      }
      const payload = await response.json();
      return Response.json(payload, { status: response.ok ? 200 : 502, headers });
    } catch {
      if (attempt + 1 === attempts) return error(body.method === "send_tx" ? "Transaction submission is uncertain. Check its execution before retrying." : "The server could not reach NEAR RPC. Check NEAR_RPC_URL or retry shortly.", 502);
    }
  }
  return error("NEAR RPC unavailable", 502);
}
