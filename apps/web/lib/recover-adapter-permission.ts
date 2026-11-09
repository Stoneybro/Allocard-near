import { decodeMutationId, parseTreasuryReference } from "@allocard/delegation-sdk";
import { Buffer } from "buffer";
import { nearBrowserRpc } from "./near-rpc-client";
/** Read-only recovery for a transaction signed before tracking was available. */
export async function recoverAdapterPermission(input: { hash: string; wallet: string; treasury: string; parentId: string; delegate: string }) {
  if (!/^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(input.hash)) throw new Error("Enter a valid NEAR transaction hash");
  const scope = parseTreasuryReference(input.treasury);
  const outcome = await nearBrowserRpc("tx", { tx_hash: input.hash, sender_account_id: input.wallet, wait_until: "FINAL" });
  if (outcome?.transaction?.signer_id !== input.wallet || outcome.transaction.receiver_id !== scope.contractId) throw new Error("Transaction belongs to a different signer or treasury");
  const actions = outcome.transaction.actions;
  if (!Array.isArray(actions) || actions.length !== 1 || actions[0].FunctionCall?.method_name !== "create_child_permission") throw new Error("Transaction did not create a child permission");
  const args = JSON.parse(Buffer.from(actions[0].FunctionCall.args, "base64").toString("utf8"));
  if (args.parent_id !== input.parentId || args.spec?.delegate !== input.delegate || (scope.companyId && args.company_id !== scope.companyId)) throw new Error("Transaction belongs to a different parent permission, company or adapter");
  return decodeMutationId(outcome);
}
