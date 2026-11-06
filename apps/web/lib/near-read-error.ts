export class NearReadError extends Error {
  constructor(public readonly operation: string, public readonly code: string, message: string) { super(`${operation}: ${message}`); this.name = "NearReadError"; }
}
export function rpcReadFailure(operation: string, error: unknown): NearReadError {
  // Report recognized public protocol codes, never raw provider errors/URLs/credentials.
  const text = JSON.stringify(error);
  const code = text.match(/ALLOCARD_[A-Z_]+/)?.[0];
  if (code) return new NearReadError(operation, code, `The contract rejected this read (${code}).`);
  if (/UNKNOWN_ACCESS_KEY|UnknownAccessKey|access key.*does not exist|access key.*not found|does not exist.*access key/i.test(text)) return new NearReadError(operation, "UNKNOWN_ACCESS_KEY", "This wallet's signing key is not registered on this NEAR network. Verify the wallet and testnet account before retrying.");
  if (/UNKNOWN_ACCOUNT|does not exist.*account|account.*does not exist/i.test(text)) return new NearReadError(operation, "UNKNOWN_ACCOUNT", "The configured account does not exist on this network.");
  if (/METHOD_NOT_FOUND|MethodNotFound|method.*not found|does not have.*method/i.test(text)) return new NearReadError(operation, "METHOD_NOT_FOUND", "This contract does not expose the required read method.");
  return new NearReadError(operation, "RPC_REJECTED", "NEAR rejected this read. Verify the treasury reference and RPC network.");
}
