export async function POST() {
  return Response.json({ code: "FEATURE_RETIRED", error: "Infrastructure provisioning is unavailable: no vendor provisioning service is integrated." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
