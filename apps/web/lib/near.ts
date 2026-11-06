import {
  AllocardTreasuryClient,
  type NearCaller,
  formatTokenAmount,
  parseTokenAmount,
  type PermissionSpec,
  type ExecuteRequest,
  type AssetId,
  parseTreasuryReference,
} from "@allocard/delegation-sdk";
import type { WalletSelector } from "@near-wallet-selector/core";
import { DEFAULT_TREASURY_CONTRACT } from "./chain";
import { nearBrowserRpc } from "./near-rpc-client";

export { formatTokenAmount, parseTokenAmount };

export type NearAuthContext = {
  status: string;
  accountId?: string;
  authMethod?: "privy" | "fast-auth" | "wallet-selector";
  caller?: NearCaller;
  selector?: WalletSelector | null;
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
      const { actionCreators } = await import("@near-wallet-selector/core");
      const wallet = await selector.wallet();
      const outcome = await wallet.signAndSendTransaction({
        signerId: accountId,
        receiverId: contractId,
        actions: [
          actionCreators.functionCall(
            methodName,
            args || {},
            BigInt(gas ? gas.toString() : "80000000000000"),
            BigInt(attachedDeposit ? attachedDeposit.toString() : "0"),
          ),
        ],
      });
      if (!outcome || typeof outcome.status !== "object" || !("SuccessValue" in outcome.status)) {
        throw new Error("Transaction was cancelled, failed, or has no confirmed outcome. Check your wallet before retrying.");
      }
      return confirmNearOutcome(outcome);
    },
  };
}

/**
 * Creates a unified NearCaller supporting both FastAuth and NEAR Wallet Selector.
 */
export async function getUnifiedNearCaller(auth: NearAuthContext): Promise<NearCaller> {
  if (auth.status !== "authenticated" || !auth.accountId) {
    return createNearRpcCaller();
  }

  if (auth.authMethod === "privy" && auth.caller) return auth.caller;

  if (auth.authMethod === "wallet-selector" && auth.selector) {
    return createNearWalletCaller(auth.selector, auth.accountId);
  }

  if (auth.authMethod === "fast-auth") {
    throw new Error("Email/social transaction signing is not configured. Connect a NEAR wallet.");
  }

  return createNearRpcCaller(auth.accountId);
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
    const result = await nearBrowserRpc("query", { request_type: "view_account", finality: "final", account_id: accountId });
    if (!result) return { totalNear: "0", availableNear: "0" };
    const amountYocto: string = result.amount;
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

/** All three pools are funded in one action batch; failure rolls the batch back. */
export async function fundTreasury(selector: WalletSelector, signerId: string, contractId: string) {
  const scope = parseTreasuryReference(contractId);
  const args = scope.companyId ? { company_id: scope.companyId } : {};
  const { actionCreators } = await import("@near-wallet-selector/core");
  const wallet = await selector.wallet();
  const outcome = await wallet.signAndSendTransaction({ signerId, receiverId: scope.contractId, actions: [
    actionCreators.functionCall("top_up_storage", args, BigInt("40000000000000"), BigInt(parseTokenAmount("0.5", 24))),
    actionCreators.functionCall("top_up_operating", args, BigInt("40000000000000"), BigInt(parseTokenAmount("0.2", 24))),
    actionCreators.functionCall("deposit_native", args, BigInt("40000000000000"), BigInt(parseTokenAmount("1", 24))),
  ] });
  if (!outcome || typeof outcome.status !== "object" || !("SuccessValue" in outcome.status)) throw new Error("Funding was not confirmed. Check the transaction before retrying.");
  return confirmNearOutcome(outcome);
}

/** Wallets may return optimistic outcomes. Resolve the actual transaction to FINAL. */
export async function confirmNearOutcome(outcome: any) {
  const txHash = outcome?.transaction?.hash || outcome?.transaction_outcome?.id;
  const signerId = outcome?.transaction?.signer_id;
  if (typeof txHash !== "string" || typeof signerId !== "string") throw new Error("Wallet did not return a transaction reference. Check its activity before retrying.");
  const result = await nearBrowserRpc("tx", { tx_hash: txHash, sender_account_id: signerId, wait_until: "FINAL" });
  if (!result || typeof result.status !== "object" || !("SuccessValue" in result.status)) {
    throw new Error(`Transaction ${txHash} was not confirmed successful. Check it before retrying.`);
  }
  return result;
}
