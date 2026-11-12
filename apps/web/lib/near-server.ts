import { SPENDING_ASSET, sameAsset } from "@/lib/chain";
import { paymentActions, containsPaymentRequest } from "./near-payment-envelope";
import { parseAccessKeyRpcResponse } from "./near-nonce";
import { coordinatedNearRead, waitForRpcCooldown, backoffNearRead, noteRpcRateLimit, rpcCooldownMs } from "./near-read-coordinator";
import { nearReadSignal, nearReadScope } from "./near-read-context";
import { NearReadError, rpcReadFailure } from "./near-read-error";
import { AllocardTreasuryClient, type Execution, type Permission, parseTreasuryReference } from "@allocard/delegation-sdk";
import { treasuryCodeHash, sharedTreasuryCodeHash, legacyTreasuryCodeHash } from "./treasury-code";
import { nearRpcServerUrl } from "./near-rpc-server";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC queries have request-specific shapes validated by their callers.
export async function nearQuery(params: Record<string, unknown>, options: { cacheMs?: number; rpcId?: unknown; dedupe?: boolean } = {}): Promise<any> {
  const normalized = { finality: "final", ...params };
  const url = nearRpcServerUrl();
  const started = Date.now();
  try {
    return await coordinatedNearRead(url, normalized, () => queryUpstream(url, normalized, options.rpcId), options.cacheMs ?? 0, options.dedupe ?? false, nearReadScope());
  } finally {
    if (Date.now() - started > 1500) console.info("[near read timing]", { operation: params.method_name ?? params.request_type, durationMs: Date.now() - started });
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC query result shape depends on request_type.
async function queryUpstream(url: string, params: Record<string, unknown>, rpcId: unknown): Promise<any> {
  const operation = typeof params.method_name === "string" ? params.method_name : String(params.request_type ?? "query");
  for (let attempt = 0; attempt < 2; attempt++) {
    nearReadSignal()?.throwIfAborted();
    if (!await waitForRpcCooldown(url)) throw new NearReadError(operation, "RATE_LIMITED", "The RPC provider requested a longer cooldown. Retry later or configure a testnet NEAR_RPC_URL with available quota.", rpcCooldownMs(url));
    try {
      const response = await fetch(url, {
        method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ jsonrpc: "2.0", id: rpcId ?? "allocard", method: "query", params: { finality: "final", ...params } }),
        signal: nearReadSignal() ? AbortSignal.any([nearReadSignal()!, AbortSignal.timeout(10_000)]) : AbortSignal.timeout(10_000),
      });
      if (!response.ok) {
        if (attempt === 0 && (response.status === 429 || response.status >= 500) && await backoffNearRead(url, response)) continue;
        if (response.status === 429) noteRpcRateLimit(url, response);
        throw new NearReadError(operation, response.status === 429 ? "RATE_LIMITED" : "HTTP_ERROR", `RPC provider returned HTTP ${response.status}. Check the server NEAR_RPC_URL.`, response.status === 429 ? rpcCooldownMs(url) : 0);
      }
      const payload = params.request_type === "view_access_key" ? parseAccessKeyRpcResponse(await response.text()) : await response.json();
      if (payload.error) throw rpcReadFailure(operation, payload.error);
      // Older query responses can put an execution error inside result.
      if (payload.result?.error) throw rpcReadFailure(operation, payload.result.error);
      if (payload.result == null) throw new NearReadError(operation, "INVALID_RESPONSE", "RPC returned no result.");
      return payload.result;
    } catch (caught) {
      nearReadSignal()?.throwIfAborted();
      if (caught instanceof NearReadError) throw caught;
      if (attempt === 1) throw new NearReadError(operation, "UNAVAILABLE", "The server could not reach NEAR RPC. Retry or check NEAR_RPC_URL.");
    }
  }
  throw new NearReadError(operation, "UNAVAILABLE", "NEAR RPC unavailable.");
}

export function treasuryReader(contractId: string, options: { cacheMs?: number } = {}) {
  return new AllocardTreasuryClient({ contractId, networkDomain: "near:testnet", caller: {
    async viewFunction({ contractId: target, methodName, args }) {
      const result = await nearQuery({ request_type: "call_function", account_id: target, method_name: methodName,
        args_base64: Buffer.from(JSON.stringify(args ?? {})).toString("base64") }, options);
      try {
        if (!Array.isArray(result.result)) throw new Error("Missing bytes");
        return JSON.parse(Buffer.from(result.result).toString("utf8"));
      } catch { throw new NearReadError(methodName, "INVALID_RESPONSE", "Contract view returned invalid JSON."); }
    },
  } });
}

export async function verifyTreasuryOwner(contractId: string, owner: string) {
  const scope = parseTreasuryReference(contractId);
  const [config, account, expectedHash, keys] = await Promise.all([
    treasuryReader(contractId).getConfig(), nearQuery({ request_type: "view_account", account_id: scope.contractId }), scope.companyId ? sharedTreasuryCodeHash() : treasuryCodeHash(),
    nearQuery({ request_type: "view_access_key_list", account_id: scope.contractId }),
  ]);
  const legacyVersion = scope.companyId ? 3 : 2;
  const releaseHash = [legacyVersion, legacyVersion + 1].includes(config.schema_version) ? await legacyTreasuryCodeHash(!!scope.companyId, config.schema_version) : expectedHash;
  assertTreasuryCode(account, releaseHash);
  if (!Array.isArray(keys.keys) || keys.keys.length !== 0) throw new Error("Treasury has retained access keys that could bypass spending policies");
  if (![legacyVersion, legacyVersion + 1, legacyVersion + 2].includes(config.schema_version) || config.network_domain !== "near:testnet" || config.owner !== owner) {
    throw new Error("Treasury must be a compatible Allocard testnet contract owned by your signing account");
  }
  return config;
}

export function assertEmployeePermission(permission: Permission | null, employee: string, owner: string, epoch: string): asserts permission is Permission {
  if (!permission || permission.delegate !== employee || permission.issuer !== owner || permission.parent_id != null || permission.revoked || permission.epoch !== epoch) {
    throw new Error("On-chain employee permission does not match this company and employee");
  }
}

export function assertSettledPayment(record: Execution | null, expected: { actor: string; permissionId: string; receiver: string; amount: string }): asserts record is Execution {
  if (!record || record.status !== "Succeeded" || record.authority_mode !== "Delegated" || record.actor !== expected.actor || record.permission_id !== expected.permissionId || !sameAsset(record.action.asset, SPENDING_ASSET) || record.action.receiver !== expected.receiver || record.action.amount !== expected.amount) {
    throw new Error("A matching, successfully settled on-chain payment is required");
  }
}

export async function verifyPaymentTransaction(txHash: string, actor: string, treasury: string, requestId: string) {
  const scope = parseTreasuryReference(treasury);
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(txHash)) throw new Error("A real NEAR transaction hash is required");
  let result;
  // Relayed transactions are indexed under the outer signer, while the treasury
  // execution actor remains the employee. Retain the relayer ID for historical reads.
  const senders = [...new Set([actor, process.env.NEAR_RELAYER_ACCOUNT_ID].filter((value): value is string => Boolean(value)))];
  for (const sender of senders) {
    try {
      const response = await fetch(nearRpcServerUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
        body: JSON.stringify({ jsonrpc: "2.0", id: "verify-payment", method: "tx", params: { tx_hash: txHash, sender_account_id: sender, wait_until: "FINAL" } }), signal: AbortSignal.timeout(15000) });
      const payload = await response.json();
      if (response.ok && !payload.error && payload.result) { result = payload.result; break; }
    } catch { /* Try the other possible signer/shard before failing verification. */ }
  }
  if (!result || typeof result.status !== "object" || !("SuccessValue" in result.status)) throw new Error("Payment transaction could not be verified");
  const transaction = result.transaction;
  if (transaction?.hash !== txHash) throw new Error("Payment transaction has a different hash");
  const matching = containsPaymentRequest(paymentActions(transaction, actor, scope.contractId), requestId, scope.companyId);
  if (!matching) throw new Error("Transaction does not contain this payment request");
}

export async function finalizedTimestamp(): Promise<bigint> {
  const response = await fetch(nearRpcServerUrl(), { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: "finalized-clock", method: "block", params: { finality: "final" } }), signal: AbortSignal.timeout(15000) });
  const payload = await response.json();
  if (!response.ok || payload.error || !payload.result?.header?.timestamp_nanosec) throw new Error("Finalized chain time unavailable");
  return BigInt(payload.result.header.timestamp_nanosec) / BigInt(1000000);
}

/** Accept an exact local deployment or an immutable global reference, never a mutable publisher. */
export function assertTreasuryCode(account: { code_hash?: string; global_contract_hash?: string | null; global_contract_account_id?: string | null }, expectedHash: string) {
  if (account.global_contract_account_id) throw new Error("Mutable global treasury code is not supported");
  const actualHash = account.global_contract_hash || account.code_hash;
  if (actualHash !== expectedHash) throw new Error("Treasury code does not match this Allocard release");
}
