import { sponsoredCreateAdapter, sponsoredCreateCompany, sponsoredExecute } from "./near-sponsor-client";
import type { SponsoredAdapterPermission } from "./near-sponsored-action";
import { nextAccessKeyNonce } from "./near-nonce";
import { Buffer } from "buffer";
import { utils } from "near-api-js";
import { createTransaction, SignedTransaction, Signature, type Action } from "near-api-js/lib/transaction";
import type { NearCaller } from "@allocard/delegation-sdk";
import { MOCK_USDC_ACCOUNT_ID, SPENDING_ASSET } from "./chain";
import { computeCompanyId } from "@allocard/delegation-sdk";
import { nearBrowserRpc } from "./near-rpc-client";
import { NearRpcError } from "./near-rpc-error";
import { RetryableNearTransactionError } from "./near-transaction-error";
import { paymentSubmission } from "./payment-submission";
import { clearPendingNearTransaction, nearRequestKey, readPendingNearTransaction, savePendingNearTransaction } from "./near-pending-transaction";
export type NearActionSender = (request: { receiverId: string; actions: Action[]; signerId?: string }) => Promise<unknown>;
export function implicitPublicKey(accountId: string) {
  if (!/^[0-9a-f]{64}$/.test(accountId)) throw new Error("Expected a NEAR Ed25519 implicit account");
  return utils.PublicKey.fromString(`ed25519:${utils.serialize.base_encode(Buffer.from(accountId, "hex"))}`);
}
const rpc = nearBrowserRpc;
/** The employee signs direct transactions or a bounded NEP-366 action; a relayer only sponsors gas. */
export function createPrivyNearTransport(accountId: string, signHash: (hash: `0x${string}`) => Promise<`0x${string}`>): { caller: NearCaller; sendActions: NearActionSender; createAdapterPermission: (input: SponsoredAdapterPermission) => Promise<unknown> } {
  const publicKey = implicitPublicKey(accountId);
  let queue: Promise<unknown> = Promise.resolve();
  const enqueue = <T,>(operation: () => Promise<T>): Promise<T> => {
    const task = queue.catch(() => undefined).then(operation);
    queue = task;
    return task;
  };
  const sendDirect = async (request: Parameters<NearActionSender>[0], requestKey = nearRequestKey(request), noteSubmission: (submitted: boolean) => void = () => {}) => {
    let submitted = true; // Storage read failures must fail closed.
    try {
    submitted = Boolean(readPendingNearTransaction(accountId));
    const signerId = request.signerId || accountId;
    const metadataOnly = request.actions.every(action => action.functionCall && ["create_company", "create_root_permission", "create_child_permission", "register_asset", "set_asset_enabled", "revoke_permission"].includes(action.functionCall.methodName));
    const waitUntil = metadataOnly ? "EXECUTED" : "FINAL";
    if (signerId !== accountId) throw new Error("Transaction signer does not match the connected wallet");
    const checkOutcome = (outcome: unknown, transactionHash: string) => {
      const status = outcome && typeof outcome === "object" && "status" in outcome ? outcome.status : null;
      if (status && typeof status === "object" && "Failure" in status) {
        clearPendingNearTransaction(accountId);
        throw new RetryableNearTransactionError(`NEAR transaction failed: ${JSON.stringify(status.Failure)}. Transaction: ${transactionHash}`);
      }
      if (!status || typeof status !== "object" || !("SuccessValue" in status)) throw new Error("NEAR has not returned a final execution outcome yet.");
      clearPendingNearTransaction(accountId);
      return outcome;
    };
    const previous = readPendingNearTransaction(accountId);
    if (previous) {
      let recovered;
      try { recovered = await rpc("tx", { tx_hash: previous.hash, sender_account_id: accountId, wait_until: "FINAL" }); }
      catch { throw new Error(`Transaction ${previous.hash} is still unconfirmed. No new transaction was signed. Retry the original action to check it again.`); }
      const outcome = checkOutcome(recovered, previous.hash);
      if (previous.requestKey !== requestKey) throw new Error(`Previous transaction ${previous.hash} confirmed. Review its result before submitting a different action. No new transaction was signed.`);
      return outcome;
    }
    const access = await rpc("query", { request_type: "view_access_key", finality: "optimistic", account_id: signerId, public_key: publicKey.toString() });
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
    const txHash = utils.serialize.base_encode(digest);
    noteSubmission(true);
    savePendingNearTransaction(accountId, { hash: txHash, requestKey });
    submitted = true;
    let outcome;
    try { outcome = await rpc("send_tx", { signed_tx_base64: Buffer.from(signed.encode()).toString("base64"), wait_until: waitUntil }); }
    catch (cause) {
      if (cause instanceof NearRpcError && cause.rpcCause === "INVALID_TRANSACTION") {
        clearPendingNearTransaction(accountId);
        noteSubmission(false);
        throw new RetryableNearTransactionError(`NEAR rejected transaction ${txHash} before execution. ${cause.message} Correct the reported cause before trying again.`);
      }
      try { outcome = await rpc("tx", { tx_hash: txHash, sender_account_id: accountId, wait_until: "FINAL" }); }
      catch { throw new Error(`Transaction ${txHash} could not be confirmed. Retry this same action to check its status; no new transaction will be signed. ${cause instanceof Error ? cause.message : ""}`); }
    }
    return checkOutcome(outcome, txHash);
    } catch (error) {
      if (!submitted && !(error instanceof RetryableNearTransactionError)) throw new RetryableNearTransactionError(error instanceof Error ? error.message : "The transaction was not submitted.");
      throw error;
    }
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
        const directRequest = { receiverId: contractId, actions: [functionCall(methodName, args ?? {}, BigInt(gas ?? "80000000000000"), BigInt(attachedDeposit ?? "0"))] };
        if (methodName === "create_company" && MOCK_USDC_ACCOUNT_ID) {
          const companyId = computeCompanyId(accountId, String((args as { company_key: string }).company_key));
          directRequest.actions.push(
            functionCall("register_asset", { company_id: companyId, asset: SPENDING_ASSET }, 25_000_000_000_000n, 0n),
            functionCall("set_asset_enabled", { company_id: companyId, asset: SPENDING_ASSET, enabled: true }, 25_000_000_000_000n, 0n),
          );
        }
        const requestKey = nearRequestKey({ contractId, methodName, args, gas: String(gas ?? "80000000000000"), attachedDeposit: String(attachedDeposit ?? "0") });
        const pending = readPendingNearTransaction(accountId);
        let pendingMethod: string | null = null;
        if (pending) { try { pendingMethod = JSON.parse(pending.requestKey).methodName ?? null; } catch { /* Unknown intents remain guarded. */ } }
        const unrelatedAdapter = pending && pendingMethod === "create_child_permission" && methodName === "execute";
        if (pending && !unrelatedAdapter) return sendDirect(directRequest, requestKey);
        if (methodName === "create_company") {
          const companyKey = (args as { company_key?: unknown } | undefined)?.company_key;
          if (typeof companyKey !== "string") throw new Error("Company workspace identity is required");
          const outcome = await sponsoredCreateCompany(accountId, { contractId, companyKey, deposit: String(attachedDeposit ?? "0"), ...(MOCK_USDC_ACCOUNT_ID ? { fundReserves: true as const } : {}) }, signHash);
          if (outcome) return outcome;
        }
        if (methodName === "execute" && String(attachedDeposit ?? "0") === "0") {
          const outcome = await sponsoredExecute(accountId, contractId, args as Parameters<typeof sponsoredExecute>[2], signHash);
          if (outcome) return outcome;
        }
        if (unrelatedAdapter) throw new Error(`Gas sponsorship is disabled. Resolve adapter transaction ${pending.hash} before using wallet-funded spending.`);
        const requestId = methodName === "execute" ? (args as { request?: { request_id?: string } })?.request?.request_id : undefined;
        const companyId = (args as { company_id?: string })?.company_id;
        const noteSubmission = requestId ? paymentSubmission(accountId, companyId ? `${contractId}#${companyId}` : contractId, requestId) : undefined;
        return sendDirect(directRequest, requestKey, noteSubmission);
      });
    },
  };
  return { caller, sendActions, createAdapterPermission: input => enqueue(() => {
    const previous = readPendingNearTransaction(accountId);
    if (previous) throw new Error(`Resolve wallet-funded transaction ${previous.hash} before creating an adapter permission. Recover it if confirmed, or use Reset rejected transaction only if RPC explicitly returned INVALID_TRANSACTION. No new meta-transaction was signed.`);
    return sponsoredCreateAdapter(accountId, input, signHash);
  }) };
}
