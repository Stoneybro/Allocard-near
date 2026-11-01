import {
  AllocardTreasuryClient,
  type NearCaller,
  formatTokenAmount,
  parseTokenAmount,
  type PermissionSpec,
  type ExecuteRequest,
  type AssetId,
} from "@allocard/delegation-sdk";
import type { WalletSelector } from "@near-wallet-selector/core";
import { DEFAULT_TREASURY_CONTRACT, NEAR_RPC_URL } from "./chain";

export { formatTokenAmount, parseTokenAmount };

/**
 * Creates a read-only NearCaller that executes queries against NEAR JSON-RPC.
 */
export function createNearRpcCaller(accountId?: string): NearCaller {
  return {
    accountId,
    async viewFunction({ contractId, methodName, args }) {
      const response = await fetch(NEAR_RPC_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0",
          id: `allocard-view-${Date.now()}`,
          method: "query",
          params: {
            request_type: "call_function",
            finality: "final",
            account_id: contractId,
            method_name: methodName,
            args_base64: Buffer.from(JSON.stringify(args || {})).toString("base64"),
          },
        }),
      });

      const data = await response.json();
      if (data.error) {
        throw new Error(data.error.message || data.error.cause?.info || "NEAR RPC view call failed");
      }
      const bytes = data.result?.result;
      if (!bytes) return null;
      const str = new TextDecoder().decode(Uint8Array.from(bytes));
      return str ? JSON.parse(str) : null;
    },
  };
}

/**
 * Creates a NearCaller that signs and submits function calls via NEAR Wallet Selector.
 */
export function createNearWalletCaller(
  selector: WalletSelector,
  accountId: string,
): NearCaller {
  const rpc = createNearRpcCaller(accountId);

  return {
    accountId,
    viewFunction: rpc.viewFunction,
    async functionCall({ contractId, methodName, args, gas, attachedDeposit }) {
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        receiverId: contractId,
        actions: [
          {
            type: "FunctionCall",
            params: {
              methodName,
              args: args || {},
              gas: gas ? gas.toString() : "80000000000000",
              deposit: attachedDeposit ? attachedDeposit.toString() : "0",
            },
          },
        ],
      });
      return outcome;
    },
  };
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

/**
 * Query native NEAR balance of any account directly from testnet RPC.
 */
export async function getNearAccountBalance(accountId: string): Promise<{
  totalNear: string;
  availableNear: string;
}> {
  if (!accountId) return { totalNear: "0", availableNear: "0" };

  try {
    const res = await fetch(NEAR_RPC_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: "view-account",
        method: "query",
        params: {
          request_type: "view_account",
          finality: "final",
          account_id: accountId,
        },
      }),
    });

    const data = await res.json();
    if (data.error || !data.result) {
      return { totalNear: "0", availableNear: "0" };
    }

    const amountYocto: string = data.result.amount;
    const formatted = formatTokenAmount(amountYocto, 24);
    // Trim display to at most 4 decimal places for UI cleanliness
    const parts = formatted.split(".");
    const display = parts[1] ? `${parts[0]}.${parts[1].slice(0, 4)}` : parts[0];

    return { totalNear: display, availableNear: display };
  } catch (err) {
    console.error("Failed to fetch NEAR balance for account", accountId, err);
    return { totalNear: "0", availableNear: "0" };
  }
}
