import { Buffer } from "buffer";
import type { WalletSelector } from "@near-wallet-selector/core";
export type SessionIdentity = { providerUserId: string; email: string; walletAddress: string };
async function readResponse(response: Response) {
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Could not verify your Allocard sign-in");
  return payload;
}
async function startSession(accountId: string, selector: WalletSelector): Promise<SessionIdentity> {
  const existing = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
  if (existing.ok) {
    const identity = await existing.json() as SessionIdentity;
    if (identity.walletAddress === accountId) return identity;
  }
  const wallet = await selector.wallet();
  const challenge = await readResponse(await fetch("/api/auth/challenge", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, walletId: wallet.id }), credentials: "same-origin", cache: "no-store",
  }));
  if (!wallet.signMessage) throw new Error("This wallet cannot sign login messages. Use a wallet supporting NEP-413, such as Meteor.");
  const proof = await wallet.signMessage({ message: challenge.message, recipient: challenge.recipient, nonce: Buffer.from(challenge.nonce, "base64"), callbackUrl: challenge.callbackUrl });
  if (!proof || proof.accountId !== accountId) throw new Error("Sign-in was cancelled or signed by another account");
  return readResponse(await fetch("/api/auth/session", {
    method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(proof),
  }));
}
export async function clearSession() {
  await readResponse(await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin", cache: "no-store" }));
}

const pendingSessions = new Map<string, Promise<SessionIdentity>>();
export function createSession(accountId: string, selector: WalletSelector): Promise<SessionIdentity> {
  const existing = pendingSessions.get(accountId);
  if (existing) return existing;
  const task = startSession(accountId, selector).finally(() => pendingSessions.delete(accountId));
  pendingSessions.set(accountId, task);
  return task;
}
