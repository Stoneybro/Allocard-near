import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { cache } from "react";
import { sessionSecret } from "./session-secret";
import { normalizeWalletAddress } from "@/lib/wallet";

const SESSION_COOKIE_NAME = "allocard_session";
const SESSION_MAX_AGE_SEC = 60 * 60 * 24;

export type SessionIdentity = {
  providerUserId: string;
  email: string;
  walletAddress: string;
};

export async function createNearSession(accountId: string, verifiedIdentity?: { providerUserId: string; email: string }): Promise<SessionIdentity> {
  const normalizedAddress = normalizeWalletAddress(accountId);
  const userEmail = verifiedIdentity?.email ?? `${normalizedAddress}@near`;

  const identity: SessionIdentity = {
    providerUserId: verifiedIdentity?.providerUserId ?? `near:${normalizedAddress}`,
    email: userEmail,
    walletAddress: normalizedAddress,
  };

  const token = await new SignJWT({ ...identity, authVersion: 2 })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(identity.providerUserId)
    .setIssuedAt()
    .setExpirationTime("24h")
    .sign(sessionSecret());

  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: SESSION_MAX_AGE_SEC,
    path: "/",
  });

  return identity;
}

export async function getSessionIdentity(): Promise<SessionIdentity | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE_NAME)?.value;
  if (!token) return null;

  try {
    const { payload } = await jwtVerify(token, sessionSecret());
    if (payload.authVersion !== 2 || typeof payload.sub !== "string" || typeof payload.walletAddress !== "string") return null;

    const email = typeof payload.email === "string" ? payload.email : `${payload.walletAddress}@near`;

    return {
      providerUserId: payload.sub,
      email,
      walletAddress: payload.walletAddress.toLowerCase(),
    };
  } catch {
    return null;
  }
}

export async function getSessionWalletAddress(): Promise<string | null> {
  return (await getSessionIdentity())?.walletAddress ?? null;
}

export async function clearSession() {
  const cookieStore = await cookies();
  cookieStore.delete(SESSION_COOKIE_NAME);
}

export const getCachedSessionWalletAddress = cache(getSessionWalletAddress);
export const getCachedSessionIdentity = cache(getSessionIdentity);
