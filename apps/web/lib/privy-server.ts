import { PrivyClient, type User } from "@privy-io/node";
export function privyClient() {
  const appId = process.env.PRIVY_APP_ID || process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  const appSecret = process.env.PRIVY_APP_SECRET;
  if (!appId || !appSecret) throw new Error("Privy app credentials are not configured on the server");
  return new PrivyClient({ appId, appSecret });
}
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
  if (accessToken.length > 16384) throw new Error("Invalid sign-in token");
  const client = privyClient();
  const auth = await client.utils().auth().verifyAccessToken(accessToken);
  const user = await client.users()._get(auth.user_id);
  if (user.id !== auth.user_id) throw new Error("Privy identity mismatch");
  return verifiedPrivyAccount(user, accountId);
}
