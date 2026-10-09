import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { getAuth } from "@/lib/auth";
import { CAL_STATE_COOKIE, calendarConfigured, startCalendarAuth } from "@/lib/calendar/google";
import { appOrigin } from "@/lib/google";

const safeReturn = (v: string | null) => (v && /^\/[\w\-/?=&%.]*$/.test(v) && !v.startsWith("//") ? v : "/settings/integrations");

/** Starts Google Calendar authorization for the signed-in user (only when they click Connect). */
export async function GET(req: Request) {
  const origin = appOrigin(req);
  const auth = await getAuth();
  if (!auth) return NextResponse.redirect(`${origin}/login`);
  const returnTo = safeReturn(new URL(req.url).searchParams.get("returnTo"));
  if (!calendarConfigured()) return NextResponse.redirect(`${origin}${returnTo}${returnTo.includes("?") ? "&" : "?"}calendar=not_configured`);
  const { url, state, verifier } = startCalendarAuth(origin, auth.email);
  const jar = await cookies();
  jar.set(CAL_STATE_COOKIE, JSON.stringify({ state, verifier, returnTo, userId: auth.userId }), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/api/calendar",
    maxAge: 600,
  });
  return NextResponse.redirect(url);
}
