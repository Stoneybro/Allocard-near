import { getSessionIdentity } from "@/lib/session";
import { LandingPageClient } from "./LandingPageClient";

export default async function Page() {
  // Routing resolves the current profile after Privy is ready. Rendering the
  // public landing page needs no dashboard/database lookup.
  const identity = await getSessionIdentity();
  return <LandingPageClient initialWalletAddress={identity?.walletAddress ?? null} />;
}
