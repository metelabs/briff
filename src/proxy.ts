import { getSessionCookie } from "better-auth/cookies";
import { NextResponse, type NextRequest } from "next/server";

// `/` is two pages: the dashboard for a member, the public landing page for everyone else.
// Only the presence of Better Auth's session cookie is checked here (no database); the
// dashboard still validates the session itself and sends a stale cookie to /login, as before.
// The landing page lives at /landing so its route never imports the dashboard's loaders.

const LANDING_PATH = "/landing";

export function proxy(request: NextRequest): NextResponse {
  if (request.nextUrl.pathname === "/" && !getSessionCookie(request)) {
    const url = request.nextUrl.clone();
    url.pathname = LANDING_PATH;
    return NextResponse.rewrite(url);
  }
  return NextResponse.next();
}

export const config = { matcher: "/" };
