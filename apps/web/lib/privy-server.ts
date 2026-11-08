import { PrivyClient, verifyAccessToken, type User } from "@privy-io/node";
import { createRemoteJWKSet, errors, importSPKI, type JWTVerifyGetKey } from "jose";

export class PrivySessionError extends Error {
  constructor(public readonly code: string, message: string, public readonly status: number) {
    super(message);
  }
}

let cached: { appId: string; appSecret: string; verificationKey?: string; client: PrivyClient; key: JWTVerifyGetKey } | undefined;
function configuration() {
  const publicAppId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appId = process.env.PRIVY_APP_ID || publicAppId;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret || (publicAppId && publicAppId !== appId)) {
    throw new PrivySessionError("AUTH_CONFIGURATION", "Sign-in is not configured correctly. Contact support.", 500);
  }
  const verificationKey = process.env.PRIVY_JWT_VERIFICATION_KEY?.replace(/\\n/g, "\n");
  if (!cached || cached.appId !== appId || cached.appSecret !== appSecret || cached.verificationKey !== verificationKey) {
    const remote = createRemoteJWKSet(new URL(`https://api.privy.io/v1/apps/${encodeURIComponent(appId)}/jwks.json`), {
      cacheMaxAge: 60 * 60 * 1000, cooldownDuration: 30_000, timeoutDuration: 5000,
    });
    let imported: ReturnType<typeof importSPKI> | undefined;
    const key: JWTVerifyGetKey = verificationKey ? async () => {
      try { return await (imported ??= importSPKI(verificationKey, "ES256")); }
      catch { throw new PrivySessionError("AUTH_CONFIGURATION", "Sign-in is not configured correctly. Contact support.", 500); }
    } : remote;
    cached = { appId, appSecret, verificationKey, key, client: new PrivyClient({ appId, appSecret, jwtVerificationKey: verificationKey, timeout: 10_000, maxRetries: 0 }) };
  }
  return cached;
}
export function privyClient() { return configuration().client; }

export function verifiedPrivyAccount(user: User, accountId: string) {
  const wallet = user.linked_accounts.find(account => account.type === "wallet" && "chain_type" in account && account.chain_type === "near" && account.address === accountId && "wallet_client_type" in account && account.wallet_client_type === "privy");
  if (!wallet || !/^[0-9a-f]{64}$/.test(accountId)) throw new Error("This NEAR signing wallet is not linked to your verified Privy identity");
  const emailAccount = user.linked_accounts.find(account => account.type === "email");
  const socialAccount = user.linked_accounts.find(account => (account.type === "google_oauth" || account.type === "apple_oauth") && account.email);
  const email = emailAccount && "address" in emailAccount ? emailAccount.address : socialAccount && "email" in socialAccount ? socialAccount.email : null;
  if (!email) throw new Error("Link a verified email address to accept company invitations");
  return { providerUserId: user.id, email: email.trim().toLowerCase(), walletAddress: accountId };
}
export async function verifyPrivySession(accessToken: string, accountId: string) {
  if (!accessToken || accessToken.length > 16384) throw new PrivySessionError("TOKEN_INVALID", "Invalid sign-in token", 401);
  const config = configuration();
  // The SDK masks resolver failures. Preserve them per request so an outage
  // cannot be mistaken for an invalid user credential.
  let keyFailure: unknown;
  const key: JWTVerifyGetKey = async (...args) => {
    try { return await config.key(...args); }
    catch (error) { keyFailure = error; throw error; }
  };
  let auth;
  try {
    auth = await verifyAccessToken({ access_token: accessToken, app_id: config.appId, verification_key: key });
  } catch (error) {
    if (keyFailure instanceof PrivySessionError) throw keyFailure;
    if (keyFailure && !(keyFailure instanceof errors.JWKSNoMatchingKey) && !(keyFailure instanceof errors.JWKSMultipleMatchingKeys)) {
      console.warn("[auth] Privy signing-key retrieval failed", { code: keyFailure instanceof errors.JOSEError ? keyFailure.code : "NETWORK_ERROR" });
      throw new PrivySessionError("AUTH_UNAVAILABLE", "Sign-in service is temporarily unavailable. Please try again shortly.", 503);
    }
    const expired = error instanceof Error && error.message === "Authentication token expired";
    throw new PrivySessionError(expired ? "TOKEN_EXPIRED" : "TOKEN_INVALID", expired ? "Your sign-in expired. Please sign in again." : "Invalid sign-in token. Please sign in again.", 401);
  }
  let user: User;
  try { user = await config.client.users()._get(auth.user_id); }
  catch {
    throw new PrivySessionError("AUTH_UNAVAILABLE", "Could not retrieve your sign-in identity. Please try again shortly.", 503);
  }
  if (user.id !== auth.user_id) throw new PrivySessionError("IDENTITY_MISMATCH", "Privy identity mismatch", 403);
  try { return { ...verifiedPrivyAccount(user, accountId), providerSessionId: auth.session_id }; }
  catch (error) { throw new PrivySessionError("IDENTITY_NOT_LINKED", error instanceof Error ? error.message : "Verify your linked wallet and email", 403); }
}
