export async function POST() {
  return Response.json({ code: "FEATURE_RETIRED", error: "Vendor purchasing is unavailable: no fulfillment provider is integrated." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
