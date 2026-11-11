import { withNearReadDeadline } from "@/lib/near-read-context";
import { withDatabaseDeadline } from "@/lib/db/transport.mjs";
import { requireSession } from "@/lib/auth-guard";
import { getCompanyDashboardState, getWalletProfile } from "@/app/actions/identity";
import { EmployerClient } from "./EmployerClient";

export default async function Page() {
  let initialProfile = null;
  let initialDashboardState = null;

  try {
    const signal = AbortSignal.timeout(20_000);
    const initial = await withNearReadDeadline(signal, () => withDatabaseDeadline(signal, async () => {
      const sessionAddr = await requireSession();
      if (!sessionAddr) return null;
      const [profile, dashboard] = await Promise.all([getWalletProfile(sessionAddr), getCompanyDashboardState(sessionAddr)]);
      return { profile, dashboard };
    }));
    initialProfile = initial?.profile ?? null;
    initialDashboardState = initial?.dashboard ?? null;
  } catch {
    // If session is not present or invalid, EmployerClient renders fallback
  }

  return (
    <EmployerClient
      initialProfile={initialProfile}
      initialDashboardState={initialDashboardState}
    />
  );
}
