import { treasuryWasm } from "@/lib/treasury-code";
export const runtime = "nodejs";
export async function GET() {
  try {
    const code = await treasuryWasm();
    return new Response(code, { headers: { "Content-Type": "application/wasm", "Cache-Control": "no-store" } });
  } catch { return Response.json({ error: "Build the treasury Wasm before running the app" }, { status: 503 }); }
}
