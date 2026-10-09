import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { CAL_STATE_COOKIE, CalendarError, exchangeCode, saveConnection } from "@/lib/calendar/google";
import { appOrigin } from "@/lib/google";
import { logError } from "@/lib/log";

/** Google redirects here after consent. Tokens are encrypted and stored server-side only. */
export async function GET(req: Request) {
  const origin = appOrigin(req);
  const url = new URL(req.url);
  const jar = await cookies();
  const raw = jar.get(CAL_STATE_COOKIE)?.value;
  jar.delete({ name: CAL_STATE_COOKIE, path: "/api/calendar" });
  let saved: { state: string; verifier: string; returnTo: string; userId: string } | null = null;
  try {
    saved = raw ? JSON.parse(raw) : null;
  } catch {
    saved = null;
  }
  const back = (code: string) => {
    const r = saved?.returnTo ?? "/settings/integrations";
    return NextResponse.redirect(`${origin}${r}${r.includes("?") ? "&" : "?"}calendar=${code}`);
  };
  const auth = await getAuth();
  if (!auth) return NextResponse.redirect(`${origin}/login`);
  if (!saved || saved.state !== url.searchParams.get("state") || saved.userId !== auth.userId) return back("state");
  if (url.searchParams.get("error")) return back(url.searchParams.get("error") === "access_denied" ? "denied" : "error");
  const code = url.searchParams.get("code");
  if (!code) return back("error");
  try {
    const t = await exchangeCode(code, saved.verifier, origin);
    await saveConnection(auth.orgId, auth.userId, t);
    await audit(auth, "calendar.connected", { subjectType: "org", subjectId: auth.orgId, meta: { complete: t.hasRequired } });
    return back(t.hasRequired ? "connected" : "permission_required");
  } catch (err) {
    if (!(err instanceof CalendarError)) logError("calendar.callback_failed", err);
    return back("error");
  }
}
