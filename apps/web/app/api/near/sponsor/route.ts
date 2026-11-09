import { sameSiteOrigin } from "@/lib/request-origin";
import { getSessionIdentity } from "@/lib/session";
import { prepareSponsoredAdapter, submitSponsoredAdapter } from "@/lib/near-sponsor-server";
import { sponsoredAdapterSchema, sponsoredAdapterProofSchema } from "@/lib/adapter-permission-schema";
import { databaseFailure } from "@/lib/db/error";
import { companySponsorshipEnabled, sponsoredCompanySchema, sponsoredCompanyProofSchema, prepareSponsoredCompany, submitSponsoredCompany, sponsorshipEnabled, sponsoredPaymentSchema, sponsoredProofSchema, prepareSponsoredPayment, submitSponsoredPayment } from "@/lib/near-sponsor-server";
export const runtime = "nodejs";
export const maxDuration = 120;
const headers = { "Cache-Control": "no-store, private" };
export async function POST(request: Request) {
  if (!sameSiteOrigin(request)) return Response.json({ error: "Wrong origin" }, { status: 403, headers });
  if (!await getSessionIdentity()) return Response.json({ error: "Sign in again to use gas sponsorship" }, { status: 401, headers });
  const text = await request.text();
  if (text.length > 8192) return Response.json({ error: "Sponsorship request is too large" }, { status: 413, headers });
  try {
    const body = JSON.parse(text);
    const { operation, ...input } = body;
    if (!["prepare", "submit", "prepare-company", "submit-company", "prepare-adapter", "submit-adapter"].includes(operation)) return Response.json({ error: "Unsupported sponsorship operation" }, { status: 400, headers });
    if (!sponsorshipEnabled()) return Response.json({ enabled: false }, { headers });
    if (operation === "prepare-adapter" || operation === "submit-adapter") {
      const schema = operation === "prepare-adapter" ? sponsoredAdapterSchema : sponsoredAdapterProofSchema;
      if (!schema.safeParse(input).success) return Response.json({ error: "Invalid sponsored adapter permission" }, { status: 400, headers });
      return Response.json(operation === "prepare-adapter" ? await prepareSponsoredAdapter(sponsoredAdapterSchema.parse(input)) : await submitSponsoredAdapter(sponsoredAdapterProofSchema.parse(input)), { headers });
    }
    if (operation === "prepare-company" || operation === "submit-company") {
      if (!companySponsorshipEnabled()) return Response.json({ enabled: false }, { headers });
      const schema = operation === "prepare-company" ? sponsoredCompanySchema : sponsoredCompanyProofSchema;
      if (!schema.safeParse(input).success) return Response.json({ error: "Invalid sponsored company registration" }, { status: 400, headers });
      const result = operation === "prepare-company"
        ? await prepareSponsoredCompany(sponsoredCompanySchema.parse(input))
        : await submitSponsoredCompany(sponsoredCompanyProofSchema.parse(input));
      return Response.json(result, { headers });
    }
    const parsed = (operation === "prepare" ? sponsoredPaymentSchema : sponsoredProofSchema).safeParse(input);
    if (!parsed.success) return Response.json({ error: "Invalid sponsored employee payment" }, { status: 400, headers });
    const result = operation === "prepare"
      ? await prepareSponsoredPayment(sponsoredPaymentSchema.parse(input))
      : await submitSponsoredPayment(sponsoredProofSchema.parse(input));
    return Response.json(result, { headers });
  } catch (caught) {
    if (caught instanceof SyntaxError || caught instanceof TypeError) return Response.json({ error: "Invalid sponsorship request" }, { status: 400, headers });
    const dbError = databaseFailure(caught);
    return Response.json({ error: dbError ?? (caught instanceof Error ? caught.message : "Gas sponsorship is unavailable") }, { status: dbError ? 503 : 409, headers });
  }
}
