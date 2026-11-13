import { nearRpcServerUrl } from "./near-rpc-server";
import { backoffNearRead, noteRpcRateLimit, waitForRpcCooldown } from "./near-read-coordinator";
import { NearRpcError, describeNearRpcError } from "./near-rpc-error";

class ProviderFailure extends Error {
  constructor(readonly code: string, readonly status?: number, readonly response?: Response) { super(code); }
}

/** Retry only reads. An uncertain broadcast must be recovered by its saved hash. */
export async function relayRpc(method: string, params: object, txHash?: string): Promise<Record<string, unknown>> {
  const url = nearRpcServerUrl();
  const read = ["status", "gas_price", "tx"].includes(method);
  for (let attempt = 0; attempt < (read ? 2 : 1); attempt++) {
    try {
      if (!await waitForRpcCooldown(url)) throw new ProviderFailure("RATE_LIMITED", 429);
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ jsonrpc: "2.0", id: "allocard-sponsor", method, params }),
        signal: AbortSignal.timeout(method === "send_tx" || method === "tx" ? 40000 : 10000),
      });
      if (!response.ok) {
        if (response.status === 429) noteRpcRateLimit(url, response);
        throw new ProviderFailure(response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR", response.status, response);
      }
      const payload = await response.json();
      if (payload.error) {
        const detail = describeNearRpcError(payload.error);
        throw new NearRpcError(detail.message, detail.rpcCause, detail.invalidReason);
      }
      if (payload.result == null) throw new ProviderFailure("INVALID_RESPONSE");
      return payload.result;
    } catch (caught) {
      if (caught instanceof NearRpcError && (caught.rpcCause === "INVALID_TRANSACTION" || (method === "tx" && caught.rpcCause === "UNKNOWN_TRANSACTION"))) throw caught;
      const failure = caught instanceof ProviderFailure ? caught : null;
      const code = failure?.code ?? (caught instanceof NearRpcError ? "RPC_ERROR" : caught instanceof Error && caught.name === "TimeoutError" ? "TIMEOUT" : "CONNECTION_ERROR");
      // Never log provider URLs, bodies, call arguments or signed transactions.
      console.warn("[sponsor RPC]", { method, attempt: attempt + 1, code, status: failure?.status, submitted: Boolean(txHash) });
      const transient = failure ? failure.status === 408 || failure.status === 429 || (failure.status != null && failure.status >= 500) || code === "INVALID_RESPONSE"
        : !(caught instanceof NearRpcError) || ["TIMEOUT_ERROR", "INTERNAL_ERROR", "UNAVAILABLE_SHARD"].includes(caught.rpcCause ?? "");
      if (read && attempt === 0 && transient) {
        if (!failure?.response || await backoffNearRead(url, failure.response)) continue;
      }
      if (txHash) throw new Error(`Sponsored transaction ${txHash} is not yet confirmed. Retry this same action to check its status; it will not be submitted again.`);
      if (failure?.status === 429) throw new Error("The NEAR RPC provider is rate limiting gas sponsorship. Wait a moment and retry the same action.");
      if (failure?.status === 401 || failure?.status === 403) throw new Error("The gas sponsor's NEAR RPC provider rejected access. The server RPC configuration needs attention.");
      throw new Error("The gas sponsor could not reach NEAR testnet. Retry the same action shortly.");
    }
  }
  throw new Error("NEAR sponsorship connection is unavailable.");
}
