export async function POST() {
  return Response.json({ code: "FEATURE_RETIRED", error: "Cross-border remittance is unavailable: no FX and settlement service is integrated." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
