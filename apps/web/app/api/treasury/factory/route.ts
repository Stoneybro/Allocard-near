import { verifiedFactoryConfig } from "@/lib/factory-server";
export const runtime = "nodejs";
export async function GET() {
  try { return Response.json(await verifiedFactoryConfig(), { headers: { "Cache-Control": "no-store" } }); }
  catch { return Response.json({ error: "The testnet treasury factory is not configured or could not be verified. Configure TREASURY_FACTORY_ACCOUNT_ID after publishing and deploying this release." }, { status: 503, headers: { "Cache-Control": "no-store" } }); }
}
