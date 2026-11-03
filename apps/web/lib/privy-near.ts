import { Buffer } from "buffer";
import { utils } from "near-api-js";
import { createTransaction, SignedTransaction, Signature, type Action } from "near-api-js/lib/transaction";
import type { NearCaller } from "@allocard/delegation-sdk";
import { NEAR_RPC_URL } from "./chain";
export type NearActionSender = (request: { receiverId: string; actions: Action[]; signerId?: string }) => Promise<any>;
export function implicitPublicKey(accountId: string) {
  if (!/^[0-9a-f]{64}$/.test(accountId)) throw new Error("Expected a NEAR Ed25519 implicit account");
  return utils.PublicKey.fromString(`ed25519:${utils.serialize.base_encode(Buffer.from(accountId, "hex"))}`);
}
async function rpc(method: string, params: unknown) {
  const response = await fetch(NEAR_RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ jsonrpc: "2.0", id: "privy-near", method, params }), signal: AbortSignal.timeout(45000) });
  const payload = await response.json();
  if (!response.ok || payload.error) throw new Error("NEAR request failed. Ensure your signing account has test NEAR for gas; check an uncertain transaction before retrying.");
  return payload.result;
}
/** A Privy user signs the real NEAR transaction digest. No server signing key. */
export function createPrivyNearTransport(accountId: string, signHash: (hash: `0x${string}`) => Promise<`0x${string}`>): { caller: NearCaller; sendActions: NearActionSender } {
  const publicKey = implicitPublicKey(accountId);
  let queue: Promise<unknown> = Promise.resolve();
  const sendActions: NearActionSender = request => {
    const task = queue.catch(() => undefined).then(async () => {
      const signerId = request.signerId || accountId;
      const access = await rpc("query", { request_type: "view_access_key", finality: "final", account_id: signerId, public_key: publicKey.toString() });
      if (access.permission !== "FullAccess" || !Number.isSafeInteger(access.nonce)) throw new Error("NEAR signing key or nonce could not be verified");
      const transaction = createTransaction(signerId, publicKey, request.receiverId, BigInt(access.nonce) + BigInt(1), request.actions, utils.serialize.base_decode(access.block_hash));
      const encoded = transaction.encode();
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", new Uint8Array(encoded)));
      const signature = await signHash(`0x${Buffer.from(digest).toString("hex")}`);
      if (!/^0x[0-9a-fA-F]{128}$/.test(signature)) throw new Error("Privy did not return an Ed25519 signature");
      const signed = new SignedTransaction({ transaction, signature: new Signature({ keyType: publicKey.keyType, data: Buffer.from(signature.slice(2), "hex") }) });
      const outcome = await rpc("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: "FINAL" });
      if (!outcome || typeof outcome.status !== "object" || !("SuccessValue" in outcome.status)) throw new Error("NEAR transaction failed. Check its execution record before retrying.");
      return outcome;
    });
    queue = task;
    return task;
  };
  const caller: NearCaller = { accountId,
    async viewFunction({ contractId, methodName, args }) {
      const result = await rpc("query", { request_type: "call_function", finality: "final", account_id: contractId, method_name: methodName, args_base64: Buffer.from(JSON.stringify(args ?? {})).toString("base64") });
      return JSON.parse(Buffer.from(result.result).toString("utf8"));
    },
    async functionCall({ contractId, methodName, args, gas, attachedDeposit }) {
      const { functionCall } = await import("near-api-js/lib/transaction");
      return sendActions({ receiverId: contractId, actions: [functionCall(methodName, args ?? {}, BigInt(gas ?? "80000000000000"), BigInt(attachedDeposit ?? "0"))] });
    },
  };
  return { caller, sendActions };
}
