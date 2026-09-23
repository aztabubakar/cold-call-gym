import { NextResponse, type NextRequest } from "next/server";
import { ACCESS_COOKIE_NAME } from "@/lib/access-cookie";

const PROTECTED_PREFIXES = ["/dashboard", "/scenarios", "/call", "/report"];
const START_PAGE = "/start";

/**
 * Access gating, not authentication. Cold Call Gym has no accounts — this
 * only checks whether the access-session cookie is PRESENT, redirecting
 * to /start if it's missing. It deliberately does NOT resolve the cookie
 * to a real lead (that would need the storage layer, which this Edge
 * middleware avoids depending on): a stale or unknown identifier passes
 * this cheap check and is caught by the authoritative lookup each
 * protected page/API route already does via lib/server/access.ts's
 * getCurrentLead(), which redirects to /start itself when the identifier
 * doesn't resolve to anything. See docs/SECURITY.md for what this cookie
 * does and doesn't prove.
 */
export function middleware(request: NextRequest) {
  const path = request.nextUrl.pathname;
  const hasAccessCookie = Boolean(request.cookies.get(ACCESS_COOKIE_NAME)?.value);
  const isProtected = PROTECTED_PREFIXES.some((prefix) => path.startsWith(prefix));
  const isStartPage = path.startsWith(START_PAGE);

  if (!hasAccessCookie && isProtected) {
    const url = request.nextUrl.clone();
    url.pathname = START_PAGE;
    url.searchParams.set("redirect", path);
    return NextResponse.redirect(url);
  }

  if (hasAccessCookie && isStartPage) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
