import "server-only";
import { createHash, randomBytes } from "node:crypto";

// Google sign-in via OpenID Connect (authorization code flow with PKCE).
// The ID token is received directly from Google's token endpoint over TLS using our
// client secret, so per OIDC Core §3.1.3.7 we validate its claims (iss, aud, exp,
// nonce) rather than its signature.

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const ISSUERS = ["https://accounts.google.com", "accounts.google.com"];

export const OAUTH_COOKIE = "talyn_google_oauth";
export const PENDING_COOKIE = "talyn_google_signup";

export function googleConfigured() {
  return Boolean(process.env.GOOGLE_CLIENT_ID?.trim() && process.env.GOOGLE_CLIENT_SECRET?.trim());
}

/** Optional allow-list of email domains, e.g. "acme.com,acme.co.uk". Empty = any verified Google account. */
export function allowedDomains(): string[] {
  return (process.env.GOOGLE_ALLOWED_DOMAINS ?? "")
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter(Boolean);
}

/** Public base URL. APP_URL wins so the redirect URI always matches what's registered with Google. */
export function appOrigin(req: Request) {
  const configured = process.env.APP_URL?.trim().replace(/\/+$/, "");
  return configured || new URL(req.url).origin;
}

export function redirectUri(req: Request) {
  return `${appOrigin(req)}/api/auth/google/callback`;
}

const b64url = (buf: Buffer) => buf.toString("base64url");

export function startAuth(req: Request) {
  const state = b64url(randomBytes(24));
  const nonce = b64url(randomBytes(24));
  const verifier = b64url(randomBytes(48));
  const challenge = b64url(createHash("sha256").update(verifier).digest());
  const params = new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID!,
    redirect_uri: redirectUri(req),
    response_type: "code",
    scope: "openid email profile",
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: "S256",
    prompt: "select_account",
  });
  const domains = allowedDomains();
  if (domains.length === 1) params.set("hd", domains[0]); // hint only; enforced on callback
  return { url: `${AUTH_URL}?${params}`, cookieValue: JSON.stringify({ state, nonce, verifier }) };
}

export type GoogleProfile = { sub: string; email: string; name: string };

export class GoogleAuthError extends Error {
  constructor(public code: "denied" | "state" | "exchange" | "token" | "unverified" | "domain") {
    super(code);
  }
}

export async function finishAuth(req: Request, cookieValue: string | undefined): Promise<GoogleProfile> {
  const url = new URL(req.url);
  if (url.searchParams.get("error")) throw new GoogleAuthError("denied");
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  let saved: { state: string; nonce: string; verifier: string };
  try {
    saved = JSON.parse(cookieValue ?? "");
  } catch {
    throw new GoogleAuthError("state");
  }
  if (!code || !state || !saved?.state || state !== saved.state) throw new GoogleAuthError("state");

  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: process.env.GOOGLE_CLIENT_ID!,
      client_secret: process.env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: redirectUri(req),
      grant_type: "authorization_code",
      code_verifier: saved.verifier,
    }),
    cache: "no-store",
  });
  if (!res.ok) throw new GoogleAuthError("exchange");
  const { id_token } = (await res.json()) as { id_token?: string };
  if (!id_token) throw new GoogleAuthError("exchange");

  let claims: Record<string, unknown>;
  try {
    claims = JSON.parse(Buffer.from(id_token.split(".")[1], "base64url").toString("utf8"));
  } catch {
    throw new GoogleAuthError("token");
  }
  const now = Math.floor(Date.now() / 1000);
  if (
    !ISSUERS.includes(String(claims.iss)) ||
    claims.aud !== process.env.GOOGLE_CLIENT_ID ||
    typeof claims.exp !== "number" ||
    claims.exp < now ||
    claims.nonce !== saved.nonce ||
    typeof claims.sub !== "string" ||
    typeof claims.email !== "string"
  )
    throw new GoogleAuthError("token");
  if (claims.email_verified !== true) throw new GoogleAuthError("unverified");

  const email = claims.email.toLowerCase();
  const domains = allowedDomains();
  if (domains.length && !domains.includes(email.split("@")[1] ?? "")) throw new GoogleAuthError("domain");

  const name = typeof claims.name === "string" && claims.name.trim() ? claims.name.trim().slice(0, 120) : email.split("@")[0];
  return { sub: claims.sub, email, name };
}

export const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  denied: "Google sign-in was cancelled.",
  state: "Your sign-in session expired. Please try again.",
  exchange: "Google sign-in couldn't be completed. Please try again.",
  token: "Google sign-in couldn't be verified. Please try again.",
  unverified: "Your Google account's email address isn't verified.",
  domain: "Sign-in with this Google account's domain isn't allowed for this workspace.",
  config: "Google sign-in isn't configured on this server.",
  failed: "Something went wrong signing in with Google. Please try again.",
};
