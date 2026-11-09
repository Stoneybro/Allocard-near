type RpcError = { message?: unknown; cause?: { name?: unknown; info?: { cause?: unknown } }; data?: unknown };
export class NearRpcError extends Error {
  constructor(message: string, readonly rpcCause: string | null, readonly invalidReason: unknown = null) { super(message); this.name = "NearRpcError"; }
}
export function describeNearRpcError(error: RpcError) {
  const rpcCause = typeof error.cause?.name === "string" ? error.cause.name : null;
  const data = error.data && typeof error.data === "object" ? error.data as { TxExecutionError?: { InvalidTxError?: unknown } } : null;
  const invalidReason = data?.TxExecutionError?.InvalidTxError ?? null;
  const reason = invalidReason !== null ? JSON.stringify(invalidReason).slice(0, 1800) : typeof error.cause?.info?.cause === "string" ? error.cause.info.cause : typeof error.data === "string" ? error.data.slice(0, 600) : "";
  return { rpcCause, invalidReason, message: `${typeof error.message === "string" ? error.message : "NEAR RPC error"}${rpcCause ? `: ${rpcCause}` : ""}${reason ? ` (${reason})` : ""}` };
}
