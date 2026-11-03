/**
 * Resolve the browser origin using the same public-host precedence as Next.js.
 * Reverse proxies must overwrite forwarded headers with the incoming public host.
 * Never use the Origin header alone to decide which site is trusted.
 */
export function sameSiteOrigin(request: Request): string | null {
  const value = request.headers.get("origin");
  if (!value || value === "null") return null;
  try {
    const origin = new URL(value);
    if (!['http:', 'https:'].includes(origin.protocol) || origin.origin !== value) return null;
    const internal = new URL(request.url);
    const host = request.headers.get("x-forwarded-host") ?? request.headers.get("host") ?? internal.host;
    if (!host || /[,\s/@?#\\]/.test(host)) return null;
    const protocol = request.headers.get("x-forwarded-proto");
    if (protocol && (protocol !== "http" && protocol !== "https")) return null;
    const expected = new URL(`${protocol ? protocol + ':' : origin.protocol}//${host}`);
    return expected.origin === origin.origin ? origin.origin : null;
  } catch {
    return null;
  }
}
