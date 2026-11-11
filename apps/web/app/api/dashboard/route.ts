import { withDatabaseDeadline } from "@/lib/db/transport.mjs";
import { getSessionIdentity } from "@/lib/session";
import { getWalletProfile, getEmployeeDashboardState, getCompanyDashboardState } from "@/app/actions/identity";
import { withNearReadDeadline } from "@/lib/near-read-context";
import { NearReadError } from "@/lib/near-read-error";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, private" };
/** Independent, bounded reads never wait behind signing in the server action queue. */
export async function GET(request: Request) {
  return withNearReadDeadline(request.signal, () => withDatabaseDeadline(request.signal, async () => {
    const view = new URL(request.url).searchParams.get("view");
    const started = Date.now();
    try {
      const identity = await getSessionIdentity();
      if (!identity) return Response.json({ error: "Sign in again to load your dashboard" }, { status: 401, headers });
      if (new URL(request.url).searchParams.get("wallet") !== identity.walletAddress) return Response.json({ error: "Dashboard identity changed. Refresh your session." }, { status: 403, headers });
      if (!["profile", "employee", "employer"].includes(view ?? "")) return Response.json({ error: "Invalid dashboard view" }, { status: 400, headers });
      const data = view === "profile" ? await getWalletProfile(identity.walletAddress)
        : view === "employee" ? await getEmployeeDashboardState(identity.walletAddress)
        : await getCompanyDashboardState(identity.walletAddress);
      return Response.json(data, { headers });
    } catch (caught) {
      console.error("[dashboard read]", { view, error: caught instanceof Error ? caught.name : "UnknownError" });
      const limited = caught instanceof NearReadError && caught.code === "RATE_LIMITED";
      const seconds = limited ? Math.max(1, Math.ceil(caught.retryAfterMs / 1000)) : 10;
      return Response.json({ error: limited ? "Live balances are temporarily unavailable while the network connection recovers. Please retry shortly." : "Your dashboard could not be loaded. Please retry.", code: limited ? "RATE_LIMITED" : "UNAVAILABLE" }, { status: limited ? 429 : 503, headers: { ...headers, "Retry-After": String(seconds) } });
    } finally {
      if (Date.now() - started > 1500) console.info("[dashboard timing]", { view, durationMs: Date.now() - started });
    }
  }));
}
