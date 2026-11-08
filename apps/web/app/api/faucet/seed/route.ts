export async function POST() {
  return Response.json({ code: "FEATURE_RETIRED", error: "The legacy faucet has been retired. Use the configured NEAR testnet funding flow." }, { status: 410, headers: { "Cache-Control": "no-store" } });
}
