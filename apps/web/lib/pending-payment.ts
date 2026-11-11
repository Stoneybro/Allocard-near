import { SPENDING_ASSET, sameAsset } from "@/lib/chain";
import { generateRequestId, type ExecuteRequest, type Execution } from "@allocard/delegation-sdk";

export type PendingPayment = {
  request: ExecuteRequest;
  transactionHash?: string;
  executionId?: string;
  delegationId?: string;
  attempted?: boolean;
  submissionAttempted?: boolean;
};
type PaymentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export const isUnsubmittedPayment = (payment: PendingPayment) => !payment.transactionHash && !payment.executionId && (payment.submissionAttempted === false || payment.attempted === false);

/** Replace an expired intent only after finalized chain state proves it never dispatched. */
export async function preparePendingPayment(input: {
  storage: PaymentStorage; key: string; companyId: string;
  receiver: string; amount: string; activePermissionId?: string | null; delegationId?: string;
  readExecution: (requestId: string) => Promise<Execution | null>;
  now?: number;
}) {
  const { storage, key } = input;
  const now = input.now ?? Date.now();
  let saved: PendingPayment | null = JSON.parse(storage.getItem(key) || "null");
  const changed = (payment: PendingPayment) => !sameAsset(payment.request.action.asset, SPENDING_ASSET) || payment.request.action.amount !== input.amount || payment.request.action.receiver !== input.receiver;
  const draft = saved && isUnsubmittedPayment(saved);
  let existing = saved && !draft ? await input.readExecution(saved.request.request_id) : null;
  if (saved && draft && (changed(saved) || BigInt(saved.request.deadline_ms) <= BigInt(now) || saved.request.permission_id !== input.activePermissionId)) {
    storage.removeItem(key); saved = null;
  }
  if (saved && existing && (existing.status === "Failed" || (existing.status === "Succeeded" && changed(saved)))) {
    // Keep settled evidence for history reconciliation without blocking a new payment.
    storage.setItem(`${key}:settled:${saved.request.request_id}`, JSON.stringify({ payment: saved, execution: existing }));
    storage.removeItem(key); saved = null; existing = null;
  }
  if (saved && !existing && BigInt(saved.request.deadline_ms) <= BigInt(now)) {
    const response = await fetch("/api/wallet/pending", {
      method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: input.companyId, requestId: saved.request.request_id, deadlineMs: saved.request.deadline_ms }),
    });
    const status = await response.json().catch(() => null);
    if (!response.ok || !status) throw new Error(status?.error ?? "Could not confirm the previous payment's status. Retry the same payment shortly.");
    if (status.execution) {
      // A dispatch may have finalized between the first read and reconciliation.
      existing = status.execution as Execution;
    } else if (status.canDiscard === true) {
      storage.removeItem(key);
      saved = null;
    } else {
      throw new Error("The previous payment is still unresolved. Keep this request and retry after checking its on-chain status.");
    }
  }
  if (saved && changed(saved)) {
    throw new Error("A previous payment is still processing or needs reconciliation. Check its status before sending a different payment.");
  }
  if (!saved) {
    const permissionId = input.activePermissionId;
    if (!permissionId || !/^[0-9]+$/.test(permissionId)) throw new Error("A confirmed company permission is required");
    saved = {
      delegationId: input.delegationId, attempted: false, submissionAttempted: false,
      request: { api_version: 1, request_id: generateRequestId(), permission_id: permissionId,
        action: { type: "Transfer", asset: SPENDING_ASSET, receiver: input.receiver, amount: input.amount },
        deadline_ms: String(Date.now() + 15 * 60 * 1000),
      },
    };
    storage.setItem(key, JSON.stringify(saved));
  }
  return { saved, existing };
}
