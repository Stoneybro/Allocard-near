import { sameSiteOrigin } from "@/lib/request-origin";
import { getSessionIdentity } from "@/lib/session";
import { prepareSponsoredAdapter, submitSponsoredAdapter } from "@/lib/near-sponsor-server";
import { sponsoredAdapterSchema, sponsoredAdapterProofSchema } from "@/lib/adapter-permission-schema";
import { sponsoredRootSchema, sponsoredRootProofSchema } from "@/lib/adapter-permission-schema";
import { prepareSponsoredRoot, submitSponsoredRoot, RootPermissionFailedError } from "@/lib/near-root-sponsor-server";
import { sponsoredRevokeSchema, sponsoredRevokeProofSchema } from "@/lib/adapter-permission-schema";
import { prepareSponsoredRevoke, submitSponsoredRevoke } from "@/lib/near-revoke-sponsor-server";
import { databaseFailure } from "@/lib/db/error";
import { NearRpcError } from "@/lib/near-rpc-error";
import { TransactionNotSubmittedError } from "@/lib/payment-submission";
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
    if (!["prepare", "submit", "prepare-company", "submit-company", "prepare-adapter", "submit-adapter", "prepare-root", "submit-root", "prepare-revoke", "submit-revoke"].includes(operation)) return Response.json({ error: "Unsupported sponsorship operation" }, { status: 400, headers });
    if (!sponsorshipEnabled()) return Response.json({ enabled: false }, { headers });
    if (operation === "prepare-revoke" || operation === "submit-revoke") {
      const parsed = (operation === "prepare-revoke" ? sponsoredRevokeSchema : sponsoredRevokeProofSchema).safeParse(input);
      if (!parsed.success) return Response.json({ error: "Invalid sponsored revocation" }, { status: 400, headers });
      return Response.json(operation === "prepare-revoke" ? await prepareSponsoredRevoke(sponsoredRevokeSchema.parse(input)) : await submitSponsoredRevoke(sponsoredRevokeProofSchema.parse(input)), { headers });
    }
    if (operation === "prepare-root" || operation === "submit-root") {
      const parsed = (operation === "prepare-root" ? sponsoredRootSchema : sponsoredRootProofSchema).safeParse(input);
      if (!parsed.success) return Response.json({ error: "Invalid sponsored employee allowance" }, { status: 400, headers });
      return Response.json(operation === "prepare-root" ? await prepareSponsoredRoot(sponsoredRootSchema.parse(input)) : await submitSponsoredRoot(sponsoredRootProofSchema.parse(input)), { headers });
    }
    if (operation === "prepare-adapter" || operation === "submit-adapter") {
      const schema = operation === "prepare-adapter" ? sponsoredAdapterSchema : sponsoredAdapterProofSchema;
      if (!schema.safeParse(input).success) return Response.json({ error: "Invalid sponsored agent permission" }, { status: 400, headers });
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
    if (caught instanceof RootPermissionFailedError) return Response.json({ error: caught.message, submissionState: "failed" }, { status: 409, headers });
    const dbError = databaseFailure(caught);
    const notSubmitted = caught instanceof TransactionNotSubmittedError || (caught instanceof NearRpcError && caught.rpcCause === "INVALID_TRANSACTION");
    return Response.json({ error: dbError ?? (caught instanceof Error ? caught.message : "Gas sponsorship is unavailable"), ...(notSubmitted ? { submissionState: "not_submitted" } : {}) }, { status: dbError ? 503 : 409, headers });
  }
}
