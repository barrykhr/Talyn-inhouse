import "server-only";

/** Shared GET helper for sourcing connectors: timeouts and recruiter-safe error messages. */
export type SourceErrorCtor = new (message: string) => Error;

export async function getJson<T>(name: string, url: string, headers: Record<string, string>, SourceError: SourceErrorCtor, opts: { allow404?: boolean } = {}): Promise<T | null> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { accept: "application/json", "user-agent": "talyn-sourcing", ...headers }, signal: AbortSignal.timeout(20_000), cache: "no-store" });
  } catch {
    throw new SourceError(`${name} couldn't be reached. Try again in a moment.`);
  }
  if (res.status === 404 && opts.allow404) return null;
  if (res.status === 401) throw new SourceError(`${name} rejected the key. Check its setting.`);
  if (res.status === 429) throw new SourceError(`${name}'s rate limit was reached. Try again later.`);
  if (res.status === 403) throw new SourceError(`${name} refused the request (HTTP 403). Check the key's access and quota.`);
  if (!res.ok) throw new SourceError(`${name} returned an error (HTTP ${res.status}).`);
  try {
    return (await res.json()) as T;
  } catch {
    throw new SourceError(`${name} returned a response Talyn couldn't read.`);
  }
}

export async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

/** Location used when a role has none (e.g. "India"). Shared by the public-profile sources. */
export const defaultSourcingLocation = () => process.env.SOURCING_DEFAULT_LOCATION?.trim() || process.env.GITHUB_DEFAULT_LOCATION?.trim() || null;

export const cityOf = (loc: string) => loc.split(",")[0].trim();

export function linkedinFrom(url: string | null | undefined): string | null {
  const m = url?.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+/i);
  if (!m) return null;
  return m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
}

/** Programming-language names: useful as code-host filters, but noise in paper and model searches. */
const LANGUAGE_NAMES = new Set(["python", "java", "javascript", "typescript", "go", "golang", "scala", "rust", "kotlin", "swift", "ruby", "php", "dart", "r", "c", "c++", "c#", "sql", "shell", "bash"]);
export const isLanguageName = (skill: string) => LANGUAGE_NAMES.has(skill.trim().toLowerCase());
