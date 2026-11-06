type RpcObject = Record<string, unknown>;
function object(value: unknown): RpcObject | null {
  return value !== null && typeof value === "object" && !Array.isArray(value) ? value as RpcObject : null;
}
/** Read an already chain-verified direct call or NEP-366 envelope, binding its employee and target. */
export function paymentActions(transaction: unknown, actor: string, treasury: string): unknown[] {
  const tx = object(transaction);
  if (!tx || !Array.isArray(tx.actions)) return [];
  if (tx.signer_id === actor && tx.receiver_id === treasury) return tx.actions;
  if (tx.receiver_id !== actor || tx.actions.length !== 1) return [];
  const envelope = object(object(tx.actions[0])?.Delegate);
  const delegate = object(envelope?.delegate_action);
  if (!delegate || delegate.sender_id !== actor || delegate.receiver_id !== treasury || !Array.isArray(delegate.actions)) return [];
  return delegate.actions;
}
export function containsPaymentRequest(actions: unknown[], requestId: string, companyId?: string) {
  return actions.some(action => {
    const call = object(object(action)?.FunctionCall);
    if (call?.method_name !== "execute" || typeof call.args !== "string") return false;
    try {
      const args = JSON.parse(Buffer.from(call.args, "base64").toString("utf8"));
      return args.request?.request_id === requestId && (companyId ? args.company_id === companyId : args.company_id === undefined);
    } catch { return false; }
  });
}
