import { NextResponse, type NextRequest } from "next/server";

const COOKIE = "screener_session";
const PUBLIC_PATHS = ["/login", "/api/auth/login"];
// Logout must not have its cookie slid forward, or the sign-out would be undone.
const NO_REFRESH_PATHS = ["/api/auth/logout"];
const secureCookies = () => process.env.SCREENER_COOKIE_SECURE === "1";

/**
 * Baseline hardening headers. HSTS is only sent when cookies are already marked Secure,
 * because pinning HTTPS for a host that is still served over plain HTTP would lock the
 * operator out of their own dashboard.
 */
function harden(response: NextResponse) {
  const headers = response.headers;
  headers.set("X-Frame-Options", "DENY");
  headers.set("X-Content-Type-Options", "nosniff");
  headers.set("Referrer-Policy", "no-referrer");
  headers.set("Cross-Origin-Opener-Policy", "same-origin");
  if (secureCookies()) headers.set("Strict-Transport-Security", "max-age=15552000; includeSubDomains");
  return response;
}

/**
 * Edge gate: everything except the login page requires a session cookie. The cookie's
 * validity and idle expiry are checked against the store in each page/route handler,
 * because that check needs Node crypto and filesystem access.
 */
const IDLE_SECONDS = 2 * 60 * 60;

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (PUBLIC_PATHS.some((x) => pathname === x)) return harden(NextResponse.next());

  const id = req.cookies.get(COOKIE)?.value;
  if (id) {
    if (NO_REFRESH_PATHS.includes(pathname)) return harden(NextResponse.next());
    // Slide the browser cookie's expiry to match the server-side idle window, so an
    // actively used session survives past two hours while an idle one still dies.
    const response = NextResponse.next();
    response.cookies.set({
      name: COOKIE, value: id, path: "/", httpOnly: true, sameSite: "lax",
      secure: secureCookies(), maxAge: IDLE_SECONDS,
    });
    return harden(response);
  }

  if (pathname.startsWith("/api/")) {
    return harden(NextResponse.json({ error: "Unauthorized: silakan login." }, { status: 401 }));
  }
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.search = pathname === "/" ? "" : `?next=${encodeURIComponent(pathname)}`;
  return harden(NextResponse.redirect(url));
}

export const config = { matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"] };
