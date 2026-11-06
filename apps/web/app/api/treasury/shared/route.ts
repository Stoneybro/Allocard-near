import { verifiedSharedConfig } from "@/lib/shared-server";
export const runtime = "nodejs";
export async function GET() {
  try { return Response.json(await verifiedSharedConfig(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "The shared treasury is unavailable. Configure SHARED_TREASURY_ACCOUNT_ID after deploying this release." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
