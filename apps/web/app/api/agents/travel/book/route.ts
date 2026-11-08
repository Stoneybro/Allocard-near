export async function POST() {
  return Response.json({ code: "FEATURE_RETIRED", error: "Travel booking is unavailable: no booking provider is integrated." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
