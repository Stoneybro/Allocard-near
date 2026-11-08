import { NextResponse, type NextRequest } from "next/server";

/** Navigation hint only; every protected read/write validates the revocable server session. */
export function middleware(request: NextRequest) {
  const token = request.cookies.get("allocard_session")?.value;
  if (token && /^[A-Za-z0-9_-]{43}$/.test(token)) return NextResponse.next();
  const destination = new URL("/", request.url);
  destination.searchParams.set("redirect", request.nextUrl.pathname);
  return NextResponse.redirect(destination);
}
export const config = { matcher: ["/employer/:path*", "/employee/:path*"] };
