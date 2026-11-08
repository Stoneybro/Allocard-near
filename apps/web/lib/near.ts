import {
  AllocardTreasuryClient,
  type NearCaller,
  formatTokenAmount,
  parseTokenAmount,
} from "@allocard/delegation-sdk";
import { DEFAULT_TREASURY_CONTRACT } from "./chain";
import { nearBrowserRpc } from "./near-rpc-client";

export { formatTokenAmount, parseTokenAmount };

export type NearAuthContext = {
  status: string;
  accountId?: string;
  authMethod?: "privy";
  caller?: NearCaller;
};

/**
 * Creates a read-only NearCaller that executes queries against NEAR JSON-RPC.
 */
export function createNearRpcCaller(accountId?: string): NearCaller {
  return {
    accountId,
    async viewFunction({ contractId, methodName, args }) {
      const result = await nearBrowserRpc("query", {
        request_type: "call_function", finality: "final", account_id: contractId, method_name: methodName,
        args_base64: btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(args || {})))),
      });
      const bytes = result?.result;
      if (!bytes) return null;
      const str = new TextDecoder().decode(Uint8Array.from(bytes));
      return str ? JSON.parse(str) : null;
    },
  };
}

/** Resolve the Privy NEAR signer; unsigned writes fail closed. */
export async function getUnifiedNearCaller(auth: NearAuthContext): Promise<NearCaller> {
  if (auth.status !== "authenticated" || !auth.accountId || !auth.caller?.functionCall) {
    throw new Error("Sign in with Privy before submitting a transaction.");
  }
  return auth.caller;
}

/**
 * Instantiate the Allocard Treasury Client.
 */
export function getTreasuryClient(
  caller: NearCaller,
  contractId: string = DEFAULT_TREASURY_CONTRACT,
): AllocardTreasuryClient {
  return new AllocardTreasuryClient({
    contractId,
    networkDomain: "near:testnet",
    caller,
  });
}
