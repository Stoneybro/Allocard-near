const MAX_U64 = (BigInt(1) << BigInt(64)) - BigInt(1);
/** RPCs may encode u64 nonces as decimal strings. Never round them through Number. */
export function nextAccessKeyNonce(value: unknown): bigint {
  let nonce: bigint;
  if (typeof value === "bigint") nonce = value;
  else if (typeof value === "string" && /^(0|[1-9][0-9]*)$/.test(value)) nonce = BigInt(value);
  else if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) nonce = BigInt(value);
  else throw new Error("NEAR RPC returned an invalid or imprecise nonce. No transaction was signed; retry with a valid access-key response.");
  if (nonce < BigInt(0) || nonce >= MAX_U64) throw new Error("NEAR access-key nonce is outside the supported u64 range. No transaction was signed.");
  return nonce + BigInt(1);
}

/** Preserve raw JSON integer nonces before JSON.parse can round values above 2^53. */
export function parseAccessKeyRpcResponse(text: string): any {
  return JSON.parse(text.replace(/("nonce"\s*:\s*)([0-9]+)(?=\s*[,}])/g, '$1"$2"'));
}
