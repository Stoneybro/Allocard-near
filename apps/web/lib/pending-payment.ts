import { generateRequestId, type ExecuteRequest, type Execution } from "@allocard/delegation-sdk";

export type PendingPayment = {
  request: ExecuteRequest;
  transactionHash?: string;
  executionId?: string;
  delegationId?: string;
  attempted?: boolean;
};
type PaymentStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;

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
  let existing = saved ? await input.readExecution(saved.request.request_id) : null;
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
  if (saved && (saved.request.action.amount !== input.amount || saved.request.action.receiver !== input.receiver)) {
    throw new Error("A previous payment is unresolved. Retry its original recipient and amount before starting another payment.");
  }
  if (!saved) {
    const permissionId = input.activePermissionId;
    if (!permissionId || !/^[0-9]+$/.test(permissionId)) throw new Error("A confirmed company permission is required");
    saved = {
      delegationId: input.delegationId, attempted: false,
      request: { api_version: 1, request_id: generateRequestId(), permission_id: permissionId,
        action: { type: "Transfer", asset: { type: "NativeNear" }, receiver: input.receiver, amount: input.amount },
        deadline_ms: String(Date.now() + 15 * 60 * 1000),
      },
    };
    storage.setItem(key, JSON.stringify(saved));
  }
  return { saved, existing };
}
