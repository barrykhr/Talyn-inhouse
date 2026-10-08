import { NextResponse, type NextRequest } from "next/server";

// Fast path only: bounces requests without a session cookie. Real session and
// organization checks happen on the server for every page, action and route.
const PUBLIC = ["/login", "/signup", "/signup/google"];
const PUBLIC_PREFIX = ["/unsubscribe/"];

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const hasSession = Boolean(req.cookies.get("talyn_session")?.value);
  if (!hasSession && !PUBLIC.includes(pathname) && !PUBLIC_PREFIX.some((p) => pathname.startsWith(p)) && !pathname.startsWith("/api/")) {
    return NextResponse.redirect(new URL("/login", req.url));
  }
  return NextResponse.next();
}

export const config = { matcher: ["/((?!_next/|favicon.ico).*)"] };
