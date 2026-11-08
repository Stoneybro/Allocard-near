import { cookies } from "next/headers";
import { cache } from "react";
import { issueSession, readSession, revokeSession, SESSION_ABSOLUTE_SECONDS, type StoredIdentity } from "./session-store";

const SESSION_COOKIE_NAME = "allocard_session";
export type SessionIdentity = StoredIdentity;

export async function createNearSession(accountId: string, verifiedIdentity: { providerUserId: string; email: string; providerSessionId: string }): Promise<SessionIdentity> {
  const identity = { providerUserId: verifiedIdentity.providerUserId, email: verifiedIdentity.email, walletAddress: accountId };
  const token = await issueSession(identity, verifiedIdentity.providerSessionId);
  (await cookies()).set(SESSION_COOKIE_NAME, token, {
    httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", maxAge: SESSION_ABSOLUTE_SECONDS, path: "/",
  });
  return identity;
}

export const getSessionIdentity = cache(async (): Promise<SessionIdentity | null> => {
  const token = (await cookies()).get(SESSION_COOKIE_NAME)?.value;
  return token ? readSession(token) : null;
});
export async function getSessionWalletAddress() { return (await getSessionIdentity())?.walletAddress ?? null; }
export async function clearSession() {
  const store = await cookies();
  const token = store.get(SESSION_COOKIE_NAME)?.value;
  // Report failure rather than pretending a copied token was revoked.
  if (token) await revokeSession(token);
  store.delete(SESSION_COOKIE_NAME);
}
export const getCachedSessionWalletAddress = cache(getSessionWalletAddress);
export const getCachedSessionIdentity = getSessionIdentity;
