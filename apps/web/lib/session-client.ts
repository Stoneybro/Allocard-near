import { withTimeout } from "./request-timeout";
export class SessionClientError extends Error {
  constructor(message: string, public readonly status: number, public readonly code?: string) { super(message); }
}
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
  if (!response.ok) throw new SessionClientError(payload?.error ?? "Could not verify your Allocard sign-in", response.status, payload?.code);
  return payload;
}
export async function clearSession() {
  generation++;
  pendingPrivySessions.clear();
  await mutate(async () => {
    await readResponse(await fetch("/api/auth/session", { method: "DELETE", signal: AbortSignal.timeout(15_000), credentials: "same-origin", cache: "no-store" }));
  });
}

const pendingPrivySessions = new Map<string, Promise<SessionIdentity>>();
export function createPrivySession(accountId: string, getAccessToken: () => Promise<string | null>): Promise<SessionIdentity> {
  const existing = pendingPrivySessions.get(accountId);
  if (existing) return existing;
  const expected = generation;
  const task = mutate(async () => {
    // At most one refresh and two transient retries. Obtain a current token
    // for every attempt; never retry invalid signatures or configuration errors.
    let refreshed = false;
    let transientRetries = 0;
    for (;;) {
      checkGeneration(expected);
      const accessToken = await withTimeout(getAccessToken(), "Sign-in timed out. Please try again.", 15_000);
      checkGeneration(expected);
      if (!accessToken) throw new SessionClientError("Sign in again to continue", 401);
      const response = await fetch("/api/auth/session", {
        method: "POST", signal: AbortSignal.timeout(15_000), credentials: "same-origin", cache: "no-store",
        headers: { "Content-Type": "application/json" }, body: JSON.stringify({ accessToken, accountId }),
      });
      const payload = await response.json().catch(() => null);
      checkGeneration(expected);
      if (response.ok) return payload as SessionIdentity;
      if (response.status === 401 && payload?.code === "TOKEN_EXPIRED" && !refreshed) {
        refreshed = true;
      } else if (response.status === 503 && payload?.code === "AUTH_UNAVAILABLE" && transientRetries < 2) {
        transientRetries++;
      } else {
        throw new SessionClientError(payload?.error ?? "Could not verify your Allocard sign-in", response.status, payload?.code);
      }
      await new Promise(resolve => setTimeout(resolve, 500 * 2 ** transientRetries));
    }
  }).finally(() => {
    if (pendingPrivySessions.get(accountId) === task) pendingPrivySessions.delete(accountId);
  });
  pendingPrivySessions.set(accountId, task);
  return task;
}
