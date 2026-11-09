import { getSessionIdentity } from "@/lib/session";
import { getWalletProfile, getEmployeeDashboardState, getCompanyDashboardState } from "@/app/actions/identity";
export const runtime = "nodejs";
const headers = { "Cache-Control": "no-store, private" };
/** Dashboard reads must not wait in the browser's sequential Server Action queue. */
export async function GET(request: Request) {
  const identity = await getSessionIdentity();
  if (!identity) return Response.json({ error: "Sign in again to load your dashboard" }, { status: 401, headers });
  const url = new URL(request.url);
  if (url.searchParams.get("wallet") !== identity.walletAddress) return Response.json({ error: "Dashboard identity changed. Refresh your session." }, { status: 403, headers });
  const view = url.searchParams.get("view");
  if (!["profile", "employee", "employer"].includes(view ?? "")) return Response.json({ error: "Invalid dashboard view" }, { status: 400, headers });
  try {
    const data = view === "profile" ? await getWalletProfile(identity.walletAddress)
      : view === "employee" ? await getEmployeeDashboardState(identity.walletAddress)
      : await getCompanyDashboardState(identity.walletAddress);
    return Response.json(data, { headers });
  } catch (caught) {
    console.error("[dashboard read]", { view, error: caught instanceof Error ? caught.name : "UnknownError" });
    return Response.json({ error: "Your dashboard could not be loaded. Please retry." }, { status: 503, headers });
  }
}
