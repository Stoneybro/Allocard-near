import { actions, type Account } from "near-api-js";
import type { NearCaller } from "./client.js";

/** Optional near-api-js v7 binding; the core SDK remains wallet independent. */
export function createNearApiCaller(account: Pick<Account, "accountId" | "provider" | "signAndSendTransaction">): NearCaller {
  return {
    accountId: account.accountId,
    viewFunction: ({ contractId, methodName, args }) =>
      account.provider.callFunction({ contractId, method: methodName, args: args ?? {} }),
    functionCall: ({ contractId, methodName, args, gas, attachedDeposit }) =>
      account.signAndSendTransaction({
        receiverId: contractId,
        actions: [actions.functionCall(methodName, args ?? {}, BigInt(gas ?? "80000000000000"), BigInt(attachedDeposit ?? "0"))],
        waitUntil: "FINAL",
        throwOnFailure: true,
      }),
  };
}
