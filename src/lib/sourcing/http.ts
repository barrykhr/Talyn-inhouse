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

/**
 * The place name from a role location, for matching against public profiles: drops notes such as
 * "(hybrid)" or "remote" and keeps the first place ("Bengaluru (hybrid)" → "Bengaluru").
 */
export function cityOf(loc: string) {
  const parts = loc.replace(/\([^)]*\)/g, " ").split(/[,/|;]| - /);
  const clean = parts.map((p) => p.replace(/\b(hybrid|remote|on-?site|in[- ]office|wfh)\b/gi, " ").replace(/\s+/g, " ").trim());
  return clean.find((p) => p.length > 1) ?? "";
}

export function linkedinFrom(url: string | null | undefined): string | null {
  const m = url?.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+/i);
  if (!m) return null;
  return m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
}

/** Programming-language names: useful as code-host filters, but noise in paper and model searches. */
const LANGUAGE_NAMES = new Set(["python", "java", "javascript", "typescript", "go", "golang", "scala", "rust", "kotlin", "swift", "ruby", "php", "dart", "r", "c", "c++", "c#", "sql", "shell", "bash"]);
/** Alternate spellings of the same Indian city, as people write them on public profiles. */
const CITY_ALIASES: string[][] = [
  ["bengaluru", "bangalore"],
  ["mumbai", "bombay", "navi mumbai", "thane"],
  ["delhi", "new delhi", "ncr", "gurgaon", "gurugram", "noida"],
  ["chennai", "madras"],
  ["kolkata", "calcutta"],
  ["kochi", "cochin"],
  ["thiruvananthapuram", "trivandrum"],
  ["mysuru", "mysore"],
  ["visakhapatnam", "vizag"],
  ["hyderabad", "secunderabad"],
  ["pune"],
  ["ahmedabad"],
  ["jaipur"],
  ["chandigarh", "mohali"],
  ["indore"],
  ["coimbatore"],
  ["nagpur"],
  ["lucknow"],
  ["bhubaneswar"],
];
const INDIA_NAMES = ["india", "bharat"];
/** Other Indian cities and all states and union territories, as they appear on public profiles. */
const INDIA_PLACES = [
  "ghaziabad", "faridabad", "greater noida", "sonipat", "meerut", "gandhinagar", "surat", "vadodara", "baroda", "rajkot", "udaipur", "jodhpur",
  "panchkula", "ludhiana", "amritsar", "jalandhar", "dehradun", "kanpur", "varanasi", "prayagraj", "allahabad", "agra", "patna", "ranchi",
  "jamshedpur", "cuttack", "guwahati", "shillong", "raipur", "bhopal", "gwalior", "jabalpur", "nashik", "aurangabad", "kolhapur", "goa",
  "panaji", "mangalore", "mangaluru", "manipal", "hubli", "dharwad", "belgaum", "belagavi", "madurai", "tiruchirappalli", "trichy", "salem",
  "vellore", "pondicherry", "puducherry", "kozhikode", "calicut", "thrissur", "kollam", "vijayawada", "guntur", "tirupati", "warangal",
  "srinagar", "jammu", "shimla", "agartala", "imphal", "gangtok", "kota", "bikaner", "siliguri", "durgapur", "kharagpur", "roorkee",
  "andhra pradesh", "arunachal pradesh", "assam", "bihar", "chhattisgarh", "gujarat", "haryana", "himachal pradesh", "jharkhand",
  "karnataka", "kerala", "madhya pradesh", "maharashtra", "manipur", "meghalaya", "mizoram", "nagaland", "odisha", "orissa", "punjab",
  "rajasthan", "sikkim", "tamil nadu", "tamilnadu", "telangana", "tripura", "uttar pradesh", "uttarakhand", "west bengal", "ladakh",
];

/**
 * What a public profile's location may say for the role's location to count as a match, lower-case.
 * "India" matches the country or any listed city; an Indian city matches its alternate spellings.
 * Anything else matches itself.
 */
export function locationTerms(loc: string | null): string[] | null {
  const l = loc?.trim().toLowerCase();
  if (!l) return null;
  if (INDIA_NAMES.includes(l)) return [...INDIA_NAMES, ...CITY_ALIASES.flat(), ...INDIA_PLACES];
  return CITY_ALIASES.find((g) => g.includes(l)) ?? [l];
}

/** True when the profile location contains one of the terms as a whole word. An empty location never matches. */
export function locationMatches(profileLocation: string | null | undefined, terms: string[] | null): boolean {
  if (!terms) return true;
  const pl = ` ${(profileLocation ?? "").toLowerCase().replace(/[^a-z]+/g, " ")} `;
  return terms.some((t) => pl.includes(` ${t} `));
}

const titleCase = (x: string) => x.replace(/\b\w/g, (c) => c.toUpperCase());

/** Location words to send to a source that searches by location (GitHub), most common spellings first. */
export function locationSearchTerms(loc: string | null): string[] {
  const l = loc?.trim().toLowerCase();
  if (!l) return [];
  // GitHub combines several location: filters with OR, so one query can cover the whole country.
  if (INDIA_NAMES.includes(l)) return ["India", ...CITY_ALIASES.flat(), ...INDIA_PLACES].map(titleCase);
  const g = CITY_ALIASES.find((x) => x.includes(l));
  return g ? g.map(titleCase) : [loc!.trim()];
}

export const isLanguageName = (skill: string) => LANGUAGE_NAMES.has(skill.trim().toLowerCase());
