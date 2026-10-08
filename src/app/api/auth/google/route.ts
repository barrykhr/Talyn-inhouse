import { NextResponse } from "next/server";
import { OAUTH_COOKIE, appOrigin, googleConfigured, startAuth } from "@/lib/google";

// Starts Google sign-in: stores state/nonce/PKCE verifier in a short-lived httpOnly cookie.
export async function GET(req: Request) {
  if (!googleConfigured()) return NextResponse.redirect(`${appOrigin(req)}/login?error=config`);
  const { url, cookieValue } = startAuth(req);
  const res = NextResponse.redirect(url);
  res.cookies.set(OAUTH_COOKIE, cookieValue, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
