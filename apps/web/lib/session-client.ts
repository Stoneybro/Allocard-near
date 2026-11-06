import { Buffer } from "buffer";
import type { WalletSelector } from "@near-wallet-selector/core";
export type SessionIdentity = { providerUserId: string; email: string; walletAddress: string };
// Order session reads and cookie mutations so reconnect cannot reuse a cookie
// that an earlier logout is still clearing.
let mutations: Promise<unknown> = Promise.resolve();
let generation = 0;
function mutate<T>(operation: () => Promise<T>): Promise<T> {
  const task = mutations.then(operation);
  mutations = task.catch(() => undefined);
  return task;
}
function checkGeneration(expected: number) {
  if (expected !== generation) throw new Error("Sign-in was cancelled");
}
async function readResponse(response: Response) {
  const payload = response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) throw new Error(payload?.error ?? "Could not verify your Allocard sign-in");
  return payload;
}
async function startSession(accountId: string, selector: WalletSelector, expected: number): Promise<SessionIdentity> {
  checkGeneration(expected);
  const existingIdentity = await mutate(async () => {
    checkGeneration(expected);
    const existing = await fetch("/api/auth/session", { credentials: "same-origin", cache: "no-store" });
    if (!existing.ok) return null;
    return await existing.json() as SessionIdentity;
  });
  checkGeneration(expected);
  if (existingIdentity?.walletAddress === accountId) return existingIdentity;
  const wallet = await selector.wallet();
  const challenge = await readResponse(await fetch("/api/auth/challenge", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accountId, walletId: wallet.id }), credentials: "same-origin", cache: "no-store",
  }));
  checkGeneration(expected);
  if (!wallet.signMessage) throw new Error("This wallet cannot sign login messages. Use a wallet supporting NEP-413, such as Meteor.");
  const proof = await wallet.signMessage({ message: challenge.message, recipient: challenge.recipient, nonce: Buffer.from(challenge.nonce, "base64"), callbackUrl: challenge.callbackUrl });
  if (!proof || proof.accountId !== accountId) throw new Error("Sign-in was cancelled or signed by another account");
  return mutate(async () => {
    checkGeneration(expected);
    return readResponse(await fetch("/api/auth/session", {
      method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", cache: "no-store", body: JSON.stringify(proof),
    }));
  });
}
export async function clearSession() {
  generation++;
  pendingSessions.clear();
  await mutate(async () => {
    await readResponse(await fetch("/api/auth/session", { method: "DELETE", credentials: "same-origin", cache: "no-store" }));
  });
}

const pendingSessions = new Map<string, Promise<SessionIdentity>>();
export function createSession(accountId: string, selector: WalletSelector): Promise<SessionIdentity> {
  const existing = pendingSessions.get(accountId);
  if (existing) return existing;
  const task = startSession(accountId, selector, generation).finally(() => {
    if (pendingSessions.get(accountId) === task) pendingSessions.delete(accountId);
  });
  pendingSessions.set(accountId, task);
  return task;
}

export function createPrivySession(accountId: string, getAccessToken: () => Promise<string | null>): Promise<SessionIdentity> {
  const expected = generation;
  return mutate(async () => {
    checkGeneration(expected);
    const accessToken = await getAccessToken();
    checkGeneration(expected);
    if (!accessToken) throw new Error("Sign in again to continue");
    return readResponse(await fetch("/api/auth/session", {
      method: "POST", credentials: "same-origin", cache: "no-store",
      headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken, accountId }),
    }));
  });
}
