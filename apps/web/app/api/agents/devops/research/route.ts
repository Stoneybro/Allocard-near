export async function POST() {
  return Response.json({ code: "FEATURE_RETIRED", error: "Infrastructure research has been retired from this application." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
