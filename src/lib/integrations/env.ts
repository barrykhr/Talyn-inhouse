import "server-only";

export type EnvCheck = { name: string; set: boolean; secret: boolean; purpose: string };

/** Reports which variables are present. Never returns values. */
export function checkEnv(vars: { name: string; secret?: boolean; purpose: string; optional?: boolean }[]) {
  const checks: (EnvCheck & { optional: boolean })[] = vars.map((v) => ({ name: v.name, set: Boolean(process.env[v.name]?.trim()), secret: v.secret ?? false, purpose: v.purpose, optional: v.optional ?? false }));
  return { checks, ready: checks.every((c) => c.set || c.optional) };
}

export function appUrl() {
  const u = process.env.APP_URL?.trim() || (process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "http://localhost:3000");
  return u.replace(/\/$/, "");
}

/** Constant-time comparison of a bearer token against a configured secret. */
export function bearerMatches(req: Request, secret: string | undefined) {
  if (!secret) return false;
  const got = req.headers.get("authorization") ?? "";
  const want = `Bearer ${secret}`;
  if (got.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < got.length; i++) diff |= got.charCodeAt(i) ^ want.charCodeAt(i);
  return diff === 0;
}
