import "server-only";
import { KeyPair } from "near-api-js";
import { isNativeNearAccount } from "../wallet";
export function reimbursementSigner() {
  const accountId = process.env.NEAR_REIMBURSEMENT_ACCOUNT_ID;
  const secret = process.env.NEAR_REIMBURSEMENT_PRIVATE_KEY;
  if (!isNativeNearAccount(accountId) || !secret?.startsWith("ed25519:")) return null;
  try { return { accountId, key: KeyPair.fromString(secret as `ed25519:${string}`) }; }
  catch { return null; }
}
