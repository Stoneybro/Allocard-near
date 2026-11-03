import { AllocardTreasuryClient, type Execution, type Permission } from "@allocard/delegation-sdk";
import { treasuryCodeHash } from "./treasury-code";
import { NEAR_RPC_URL } from "./chain";

export async function nearQuery(params: Record<string, unknown>): Promise<any> {
  const response = await fetch(NEAR_RPC_URL, {
    method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: "allocard", method: "query", params: { finality: "final", ...params } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error("NEAR RPC unavailable; retry without changing your payment request");
  const payload = await response.json();
  if (payload.error) throw new Error("NEAR account, key or contract could not be verified");
  return payload.result;
}

export function treasuryReader(contractId: string) {
  return new AllocardTreasuryClient({ contractId, networkDomain: "near:testnet", caller: {
    async viewFunction({ methodName, args }) {
      const result = await nearQuery({ request_type: "call_function", account_id: contractId, method_name: methodName,
        args_base64: Buffer.from(JSON.stringify(args ?? {})).toString("base64") });
      return JSON.parse(Buffer.from(result.result).toString("utf8"));
    },
  } });
}

export async function verifyTreasuryOwner(contractId: string, owner: string) {
  const [config, account, expectedHash] = await Promise.all([
    treasuryReader(contractId).getConfig(), nearQuery({ request_type: "view_account", account_id: contractId }), treasuryCodeHash(),
  ]);
  if (account.code_hash !== expectedHash) throw new Error("Treasury code does not match this Allocard release");
  if (config.schema_version !== 2 || config.network_domain !== "near:testnet" || config.owner !== owner) {
    throw new Error("Treasury must be an Allocard schema-2 testnet contract owned by your signing account");
  }
  return config;
}

export function assertEmployeePermission(permission: Permission | null, employee: string, owner: string, epoch: string): asserts permission is Permission {
  if (!permission || permission.delegate !== employee || permission.issuer !== owner || permission.parent_id != null || permission.revoked || permission.epoch !== epoch) {
    throw new Error("On-chain employee permission does not match this company and employee");
  }
}

export function assertSettledPayment(record: Execution | null, expected: { actor: string; permissionId: string; receiver: string; amount: string }): asserts record is Execution {
  if (!record || record.status !== "Succeeded" || record.authority_mode !== "Delegated" || record.actor !== expected.actor || record.permission_id !== expected.permissionId || record.action.asset.type !== "NativeNear" || record.action.receiver !== expected.receiver || record.action.amount !== expected.amount) {
    throw new Error("A matching, successfully settled on-chain payment is required");
  }
}

export async function verifyPaymentTransaction(txHash: string, actor: string, treasury: string, requestId: string) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,64}$/.test(txHash)) throw new Error("A real NEAR transaction hash is required");
  const response = await fetch(NEAR_RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: "verify-payment", method: "tx", params: { tx_hash: txHash, sender_account_id: actor, wait_until: "FINAL" } }), signal: AbortSignal.timeout(15000) });
  const payload = await response.json();
  const result = payload.result;
  if (!response.ok || payload.error || !result || typeof result.status !== "object" || !("SuccessValue" in result.status)) throw new Error("Payment transaction could not be verified");
  const transaction = result.transaction;
  if (transaction?.signer_id !== actor || transaction?.receiver_id !== treasury || transaction?.hash !== txHash) throw new Error("Payment transaction has a different signer or treasury");
  const matching = transaction.actions?.some((action: any) => {
    if (action.FunctionCall?.method_name !== "execute") return false;
    try { return JSON.parse(Buffer.from(action.FunctionCall.args, "base64").toString("utf8")).request?.request_id === requestId; }
    catch { return false; }
  });
  if (!matching) throw new Error("Transaction does not contain this payment request");
}

export async function finalizedTimestamp(): Promise<bigint> {
  const response = await fetch(NEAR_RPC_URL, { method: "POST", headers: { "Content-Type": "application/json" }, cache: "no-store",
    body: JSON.stringify({ jsonrpc: "2.0", id: "finalized-clock", method: "block", params: { finality: "final" } }), signal: AbortSignal.timeout(15000) });
  const payload = await response.json();
  if (!response.ok || payload.error || !payload.result?.header?.timestamp_nanosec) throw new Error("Finalized chain time unavailable");
  return BigInt(payload.result.header.timestamp_nanosec) / BigInt(1000000);
}
