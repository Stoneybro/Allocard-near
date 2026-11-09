/** Browser requests use the app origin; RPC provider credentials stay on the server. */
import { NearRpcError, describeNearRpcError } from "./near-rpc-error";
export const BROWSER_NEAR_RPC_URL = "/api/near/rpc";
export async function nearBrowserRpc(method: string, params: unknown) {
  let response: Response;
  try {
    response = await fetch(BROWSER_NEAR_RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store",
      body: JSON.stringify({ jsonrpc: "2.0", id: "allocard-browser", method, params }), signal: AbortSignal.timeout(45000) });
  } catch {
    throw new Error(method === "send_tx" ? "Transaction submission could not be confirmed. Check its execution before retrying." : "Could not reach the app's NEAR connection. Check your connection and retry.");
  }
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload || payload.error) {
    const message = typeof payload?.error?.message === "string" ? payload.error.message : "NEAR connection unavailable. Retry after checking the RPC configuration.";
    if (payload?.error?.cause) {
      const detail = describeNearRpcError(payload.error);
      throw new NearRpcError(message, detail.rpcCause, detail.invalidReason);
    }
    throw new Error(message);
  }
  return payload.result;
}
