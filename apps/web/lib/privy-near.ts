import { sponsoredExecute } from "./near-sponsor-client";
import { nextAccessKeyNonce } from "./near-nonce";
import { Buffer } from "buffer";
import { utils } from "near-api-js";
import { createTransaction, SignedTransaction, Signature, type Action } from "near-api-js/lib/transaction";
import type { NearCaller } from "@allocard/delegation-sdk";
import { nearBrowserRpc } from "./near-rpc-client";
export type NearActionSender = (request: { receiverId: string; actions: Action[]; signerId?: string }) => Promise<any>;
export function implicitPublicKey(accountId: string) {
  if (!/^[0-9a-f]{64}$/.test(accountId)) throw new Error("Expected a NEAR Ed25519 implicit account");
  return utils.PublicKey.fromString(`ed25519:${utils.serialize.base_encode(Buffer.from(accountId, "hex"))}`);
}
const rpc = nearBrowserRpc;
/** The employee signs direct transactions or a bounded NEP-366 action; a relayer only sponsors gas. */
export function createPrivyNearTransport(accountId: string, signHash: (hash: `0x${string}`) => Promise<`0x${string}`>): { caller: NearCaller; sendActions: NearActionSender } {
  const publicKey = implicitPublicKey(accountId);
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const task = queue.catch(() => undefined).then(operation);
    queue = task;
    return task;
  };
  const sendDirect: NearActionSender = async request => {
    const signerId = request.signerId || accountId;
    if (signerId !== accountId) throw new Error("Transaction signer does not match the connected wallet");
    const access = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: signerId, public_key: publicKey.toString() });
    if (!access || typeof access !== "object" || !("permission" in access) || !("nonce" in access)) throw new Error("NEAR RPC did not return an access-key record. Check that NEAR_RPC_URL is a NEAR JSON-RPC endpoint.");
    if (access.permission !== "FullAccess") {
      const kind = typeof access.permission === "object" && access.permission ? Object.keys(access.permission).find(key => ["FunctionCall", "GasKeyFullAccess", "GasKeyFunctionCall"].includes(key)) : undefined;
      throw new Error(kind ? `The wallet key has ${kind} permission. This transaction signer requires a regular FullAccess key. No transaction was signed.` : "The wallet key does not have verified FullAccess permission. No transaction was signed.");
    }
    const nonce = nextAccessKeyNonce(access.nonce);
    let blockHash: Uint8Array;
    try {
      if (typeof access.block_hash !== "string") throw new Error("Missing block hash");
      blockHash = utils.serialize.base_decode(access.block_hash);
      if (blockHash.length !== 32) throw new Error("Invalid block hash");
    } catch { throw new Error("NEAR RPC returned an invalid recent block hash. No transaction was signed."); }
    const transaction = createTransaction(signerId, publicKey, request.receiverId, nonce, request.actions, blockHash);
    const encoded = transaction.encode();
    const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(encoded)));
    const signature = await signHash(`0x${Buffer.from(digest).toString("hex")}`);
    if (!/^0x[0-9a-fA-F]{128}$/.test(signature)) throw new Error("Privy did not return an Ed25519 signature");
    const signed = new SignedTransaction({ transaction, signature: new Signature({ keyType: publicKey.keyType, data: Buffer.from(signature.slice(2), "hex") }) });
    let outcome;
    try { outcome = await rpc("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "FINAL" }); }
    catch (cause) {
      const txHash = utils.serialize.base_encode(digest);
      throw new Error(`Transaction ${txHash} could not be confirmed. Check its status before signing another transaction. ${cause instanceof Error ? cause.message : ""}`);
    }
    if (!outcome || typeof outcome.status !== "object" || !("SuccessValue" in outcome.status)) throw new Error("NEAR transaction failed. Check its execution record before retrying.");
    return outcome;
  };
  const sendActions: NearActionSender = request => enqueue(() => sendDirect(request));
  const caller: NearCaller = { accountId,
    async viewFunction({ contractId, methodName, args }) {
      const result = await rpc("query", { request_type: "call_function", finality: "final", account_id: contractId, method_name: methodName, args_base64: Buffer.from(JSON.stringify(args ?? {})).toString("base64") });
      return JSON.parse(Buffer.from(result.result).toString("utf8"));
    },
    async functionCall({ contractId, methodName, args, gas, attachedDeposit }) {
      return enqueue(async () => {
        const { functionCall } = await import("near-api-js/lib/transaction");
        if (methodName === "execute" && String(attachedDeposit ?? "0") === "0") {
          const outcome = await sponsoredExecute(accountId, contractId, args as Parameters<typeof sponsoredExecute>[2], signHash);
          if (outcome) return outcome;
        }
        return sendDirect({ receiverId: contractId, actions: [functionCall(methodName, args ?? {}, BigInt(gas ?? "80000000000000"), BigInt(attachedDeposit ?? "0"))] });
      });
    },
  };
  return { caller, sendActions };
}
