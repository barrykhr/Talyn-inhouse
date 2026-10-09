import "server-only";
import { createHash, randomBytes } from "node:crypto";
import { db } from "../db";
import { googleConfigured } from "../google";
import { checkEnv } from "../integrations/env";
import { logError } from "../log";
import { open, seal, secretboxConfigured } from "../secretbox";

/**
 * Google Calendar for interview scheduling. Narrow scopes only:
 * - calendar.freebusy: busy/free blocks — no titles, descriptions or attendees of anyone's events.
 * - calendar.events.owned: create, change and cancel events on calendars the user owns (the
 *   interview events Talyn creates). No Gmail, Drive, Contacts or full calendar access.
 * - openid email: to show which Google account is connected.
 * Requested only when a user clicks Connect (incremental authorization), never at sign-in.
 */
export const CALENDAR_SCOPES = ["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy", "https://www.googleapis.com/auth/calendar.events.owned"];
const REQUIRED = CALENDAR_SCOPES.slice(2);
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const API = "https://www.googleapis.com/calendar/v3";
export const CAL_STATE_COOKIE = "talyn_gcal_oauth";

export const CALENDAR_ENV = [
  { name: "GOOGLE_CLIENT_ID", purpose: "OAuth client ID (the same client as Google sign-in)" },
  { name: "GOOGLE_CLIENT_SECRET", purpose: "OAuth client secret", secret: true },
  { name: "TOKEN_ENCRYPTION_KEY", purpose: "32+ random characters; encrypts Google tokens at rest", secret: true },
  { name: "GOOGLE_CALENDAR_ENABLED", purpose: "Set to true after enabling the Calendar API and adding the scopes to the consent screen" },
];

/** Live Calendar needs the OAuth client, an encryption key, and an explicit opt-in. Otherwise: demo mode. */
export function calendarConfigured() {
  return googleConfigured() && secretboxConfigured() && process.env.GOOGLE_CALENDAR_ENABLED === "true";
}
export function calendarSetup() {
  return checkEnv(CALENDAR_ENV);
}

export function calendarRedirectUri(origin: string) {
  return `${origin}/api/calendar/callback`;
}

export function startCalendarAuth(origin: string, loginHint: string) {
  const state = randomBytes(24).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: calendarRedirectUri(origin),
    response_type: "code",
    scope: CALENDAR_SCOPES.join(" "),
    access_type: "offline", // refresh token, so scheduling works later without re-consent
    prompt: "consent",
    include_granted_scopes: "false",
    login_hint: loginHint,
    state,
    code_challenge: createHash("sha256").update(verifier).digest("base64url"),
    code_challenge_method: "S256",
  });
  return { url: `${AUTH_URL}?${params}`, state, verifier };
}

export type CalendarErrorKind = "not_connected" | "revoked" | "permission" | "rate_limit" | "timeout" | "not_found" | "conflict" | "api";
export class CalendarError extends Error {
  constructor(
    public kind: CalendarErrorKind,
    message: string,
    public status?: number,
  ) {
    super(message);
  }
}
const MESSAGES: Record<CalendarErrorKind, string> = {
  not_connected: "Google Calendar isn't connected for this person.",
  revoked: "Google access was revoked or expired. Reconnect Google Calendar.",
  permission: "Google denied permission for this calendar action. Reconnect and allow the requested Calendar access.",
  rate_limit: "Google Calendar rate limit reached. Wait a minute and try again.",
  timeout: "Google Calendar didn't respond in time. Try again.",
  not_found: "The calendar or event wasn't found in Google Calendar.",
  conflict: "That event already exists in Google Calendar.",
  api: "Google Calendar returned an error. Try again.",
};
export const errorMessage = (e: unknown) => (e instanceof CalendarError ? e.message : "Something went wrong talking to Google Calendar. Try again.");

/** Exchanges the authorization code. Returns the granted scopes and the account email. */
export async function exchangeCode(code: string, verifier: string, origin: string) {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ code, client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, redirect_uri: calendarRedirectUri(origin), grant_type: "authorization_code", code_verifier: verifier }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new CalendarError("api", "Google didn't accept the authorization. Try connecting again.", res.status);
  const t = (await res.json()) as { access_token: string; refresh_token?: string; expires_in: number; scope?: string; id_token?: string };
  let email = "";
  try {
    // Received directly from Google's token endpoint over TLS with our client secret.
    const claims = JSON.parse(Buffer.from((t.id_token ?? "").split(".")[1] ?? "", "base64url").toString("utf8"));
    if (claims.aud === process.env.GOOGLE_CLIENT_ID) email = String(claims.email ?? "").toLowerCase();
  } catch {
    /* email stays empty */
  }
  const granted = (t.scope ?? "").split(" ");
  return { ...t, email, granted, hasRequired: REQUIRED.every((s) => granted.includes(s)) };
}

export async function saveConnection(orgId: string, userId: string, t: Awaited<ReturnType<typeof exchangeCode>>) {
  const existing = await db.calendarConnection.findUnique({ where: { userId_orgId: { userId, orgId } } });
  const data = {
    googleEmail: t.email || existing?.googleEmail || "",
    scopes: t.granted.join(" "),
    accessTokenEnc: seal(t.access_token),
    refreshTokenEnc: t.refresh_token ? seal(t.refresh_token) : (existing?.refreshTokenEnc ?? null),
    expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000),
    status: t.hasRequired ? "connected" : "permission_required",
    lastError: t.hasRequired ? null : "Free/busy and event permissions weren't both granted.",
    connectedAt: new Date(),
  };
  await db.calendarConnection.upsert({ where: { userId_orgId: { userId, orgId } }, create: { orgId, userId, ...data }, update: data });
}

/** A valid access token for a user, refreshing it when needed. Marks the connection revoked on invalid_grant. */
async function accessToken(orgId: string, userId: string): Promise<{ token: string; email: string }> {
  const c = await db.calendarConnection.findUnique({ where: { userId_orgId: { userId, orgId } } });
  if (!c || !c.accessTokenEnc) throw new CalendarError("not_connected", MESSAGES.not_connected);
  if (c.status === "revoked") throw new CalendarError("revoked", MESSAGES.revoked);
  if (c.status === "permission_required") throw new CalendarError("permission", MESSAGES.permission);
  if (c.expiresAt && c.expiresAt > new Date()) return { token: open(c.accessTokenEnc), email: c.googleEmail };
  if (!c.refreshTokenEnc) {
    await db.calendarConnection.update({ where: { id: c.id }, data: { status: "revoked", lastError: "No refresh token" } });
    throw new CalendarError("revoked", MESSAGES.revoked);
  }
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID!, client_secret: process.env.GOOGLE_CLIENT_SECRET!, refresh_token: open(c.refreshTokenEnc), grant_type: "refresh_token" }),
    cache: "no-store",
    signal: AbortSignal.timeout(15000),
  }).catch(() => null);
  if (!res) throw new CalendarError("timeout", MESSAGES.timeout);
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    if (body.error === "invalid_grant") {
      await db.calendarConnection.update({ where: { id: c.id }, data: { status: "revoked", lastError: "Access revoked or expired", accessTokenEnc: null } });
      throw new CalendarError("revoked", MESSAGES.revoked);
    }
    await db.calendarConnection.update({ where: { id: c.id }, data: { status: "error", lastError: `Token refresh failed (HTTP ${res.status})` } });
    throw new CalendarError("api", MESSAGES.api, res.status);
  }
  const t = (await res.json()) as { access_token: string; expires_in: number };
  await db.calendarConnection.update({ where: { id: c.id }, data: { accessTokenEnc: seal(t.access_token), expiresAt: new Date(Date.now() + (t.expires_in - 60) * 1000), status: "connected", lastError: null } });
  return { token: t.access_token, email: c.googleEmail };
}

async function call<T>(orgId: string, userId: string, path: string, init: RequestInit = {}): Promise<T> {
  const { token } = await accessToken(orgId, userId);
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, "content-type": "application/json", ...(init.headers ?? {}) }, cache: "no-store", signal: AbortSignal.timeout(20000) });
  } catch {
    throw new CalendarError("timeout", MESSAGES.timeout);
  }
  if (res.status === 204) return undefined as T;
  if (res.ok) return (await res.json()) as T;
  const body = (await res.json().catch(() => ({}))) as { error?: { errors?: { reason?: string }[]; message?: string } };
  const reason = body.error?.errors?.[0]?.reason ?? "";
  logError("calendar.api_error", new Error(`HTTP ${res.status} ${reason}`), { path: path.split("?")[0] });
  if (res.status === 401) {
    await db.calendarConnection.updateMany({ where: { userId, orgId }, data: { status: "revoked", lastError: "Google rejected the access token" } });
    throw new CalendarError("revoked", MESSAGES.revoked, 401);
  }
  if (res.status === 429 || reason === "rateLimitExceeded" || reason === "userRateLimitExceeded") throw new CalendarError("rate_limit", MESSAGES.rate_limit, res.status);
  if (res.status === 403) {
    if (reason === "insufficientPermissions" || reason === "forbidden") await db.calendarConnection.updateMany({ where: { userId, orgId }, data: { status: "permission_required", lastError: "Insufficient Calendar permissions" } });
    throw new CalendarError("permission", MESSAGES.permission, 403);
  }
  if (res.status === 404 || res.status === 410) throw new CalendarError("not_found", MESSAGES.not_found, res.status);
  if (res.status === 409) throw new CalendarError("conflict", MESSAGES.conflict, 409);
  throw new CalendarError("api", MESSAGES.api, res.status);
}

/**
 * Free/busy for calendars, queried with one user's authorization. `ids` are calendar IDs
 * ("primary" or an email whose owner shared free/busy with this user). Returns busy blocks only;
 * calendars Google won't disclose come back as errors (→ "unknown"), never as free.
 */
export async function freeBusy(orgId: string, userId: string, ids: string[], timeMin: Date, timeMax: Date) {
  const r = await call<{ calendars: Record<string, { busy?: { start: string; end: string }[]; errors?: { reason: string }[] }> }>(orgId, userId, "/freeBusy", {
    method: "POST",
    body: JSON.stringify({ timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString(), items: ids.map((id) => ({ id })) }),
  });
  return Object.fromEntries(
    ids.map((id) => {
      const c = r.calendars?.[id];
      if (!c || c.errors?.length) return [id, { ok: false as const, reason: c?.errors?.[0]?.reason ?? "notFound" }];
      return [id, { ok: true as const, busy: (c.busy ?? []).map((b) => ({ start: Date.parse(b.start), end: Date.parse(b.end) })) }];
    }),
  );
}

export type GEvent = {
  id: string;
  status: string;
  htmlLink?: string;
  hangoutLink?: string;
  conferenceData?: { createRequest?: { status?: { statusCode?: string } }; entryPoints?: { entryPointType: string; uri: string }[] };
  attendees?: { email: string; responseStatus?: string }[];
};

/** Google event IDs allow base32hex characters; derive one from our idempotency key. */
export function eventIdFor(requestKey: string) {
  return createHash("sha256").update(requestKey).digest("hex").slice(0, 40); // hex ⊂ base32hex
}

export function meetFrom(e: GEvent): { url: string | null; status: "created" | "pending" | "unavailable" } {
  const video = e.conferenceData?.entryPoints?.find((p) => p.entryPointType === "video")?.uri ?? e.hangoutLink ?? null;
  if (video) return { url: video, status: "created" };
  const code = e.conferenceData?.createRequest?.status?.statusCode;
  return { url: null, status: code === "pending" ? "pending" : "unavailable" };
}

export async function createEvent(
  orgId: string,
  userId: string,
  input: { requestKey: string; summary: string; description: string; start: Date; end: Date; timeZone: string; attendees: { email: string; displayName?: string }[]; withMeet: boolean; location?: string | null },
): Promise<GEvent> {
  const id = eventIdFor(input.requestKey);
  const body = {
    id, // client-supplied ID: a retry returns 409 instead of creating a duplicate
    summary: input.summary,
    description: input.description,
    location: input.location ?? undefined,
    start: { dateTime: input.start.toISOString(), timeZone: input.timeZone },
    end: { dateTime: input.end.toISOString(), timeZone: input.timeZone },
    attendees: input.attendees,
    guestsCanSeeOtherGuests: true,
    reminders: { useDefault: true },
    ...(input.withMeet ? { conferenceData: { createRequest: { requestId: `talyn-${id}`, conferenceSolutionKey: { type: "hangoutsMeet" } } } } : {}),
  };
  try {
    return await call<GEvent>(orgId, userId, `/calendars/primary/events?sendUpdates=all${input.withMeet ? "&conferenceDataVersion=1" : ""}`, { method: "POST", body: JSON.stringify(body) });
  } catch (err) {
    // Same request retried: the event already exists — return it rather than creating another.
    if (err instanceof CalendarError && err.kind === "conflict") return getEvent(orgId, userId, id);
    throw err;
  }
}

export function getEvent(orgId: string, userId: string, eventId: string) {
  return call<GEvent>(orgId, userId, `/calendars/primary/events/${encodeURIComponent(eventId)}`);
}

export function patchEvent(orgId: string, userId: string, eventId: string, patch: { start: Date; end: Date; timeZone: string }) {
  return call<GEvent>(orgId, userId, `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all&conferenceDataVersion=1`, {
    method: "PATCH",
    body: JSON.stringify({ start: { dateTime: patch.start.toISOString(), timeZone: patch.timeZone }, end: { dateTime: patch.end.toISOString(), timeZone: patch.timeZone } }),
  });
}

export async function cancelEvent(orgId: string, userId: string, eventId: string) {
  try {
    await call<void>(orgId, userId, `/calendars/primary/events/${encodeURIComponent(eventId)}?sendUpdates=all`, { method: "DELETE" });
  } catch (err) {
    if (err instanceof CalendarError && err.kind === "not_found") return; // already gone in Google
    throw err;
  }
}

/** Disconnect: revoke at Google (best effort) and delete the stored tokens. */
export async function disconnect(orgId: string, userId: string) {
  const c = await db.calendarConnection.findUnique({ where: { userId_orgId: { userId, orgId } } });
  if (!c) return;
  const tok = c.refreshTokenEnc ?? c.accessTokenEnc;
  if (tok)
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(open(tok))}`, { method: "POST", signal: AbortSignal.timeout(10000) }).catch(() => logError("calendar.revoke_failed", new Error("revoke request failed")));
  await db.calendarConnection.delete({ where: { id: c.id } });
}
