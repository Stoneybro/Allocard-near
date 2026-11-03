import { sameSiteOrigin } from "@/lib/request-origin";
import { randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import { SignJWT } from "jose";
import { sessionSecret } from "@/lib/session-secret";
import { isNativeNearAccount } from "@/lib/wallet";

export async function POST(request: Request) {
  const origin = sameSiteOrigin(request);
  if (!origin) return Response.json({ error: "Wrong origin" }, { status: 403 });
  const { accountId, walletId } = await request.json();
  if (!isNativeNearAccount(accountId)) return Response.json({ error: "Invalid NEAR account" }, { status: 400 });
  const challenge = { accountId, ...(walletId === "my-near-wallet" ? { callbackUrl: origin + "/" } : {}), nonce: randomBytes(32).toString("base64"), recipient: origin, message: "Sign in to Allocard. This signature does not authorize a payment." };
  const token = await new SignJWT(challenge).setProtectedHeader({ alg: "HS256" }).setAudience("allocard-login").setIssuedAt().setExpirationTime("5m").sign(sessionSecret());
  (await cookies()).set("allocard_login_challenge", token, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "strict", path: "/", maxAge: 300 });
  return Response.json(challenge, { headers: { "Cache-Control": "no-store" } });
}
