import "server-only";
import { isNativeNearAccount } from "../wallet";
export function adapterAccount() {
  const value = process.env.NEAR_ADAPTER_ACCOUNT_ID;
  return isNativeNearAccount(value) ? value! : null;
}
export function workerConfig() {
  const secret = process.env.ALLOCARD_AGENT_SECRET;
  const value = process.env.ALLOCARD_AGENT_URL || "https://purchasing-research-agent-v2.vercel.app";
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash) throw new Error("Invalid agent origin configuration");
  if (!secret || secret.length < 32) throw new Error("The research worker connection is not configured yet.");
  return { origin: url.origin, secret };
}
