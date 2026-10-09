// Structured search filters and a generic Boolean rendering. Pure — safe on client and server.

export type SearchFilters = {
  keywords: string[]; // the recruiter's search query, as terms
  titles: string[];
  adjacent_titles: string[];
  skills_required: string[];
  skills_preferred: string[];
  locations: string[];
  seniority: string[];
  industries: string[];
  exclusions: string[];
};

export const FILTER_LABEL: Record<keyof SearchFilters, string> = {
  keywords: "Search query",
  titles: "Titles",
  adjacent_titles: "Adjacent titles",
  skills_required: "Required skills",
  skills_preferred: "Preferred skills",
  locations: "Locations",
  seniority: "Seniority",
  industries: "Industries / company contexts",
  exclusions: "Exclusions",
};

export const EMPTY_FILTERS: SearchFilters = { keywords: [], titles: [], adjacent_titles: [], skills_required: [], skills_preferred: [], locations: [], seniority: [], industries: [], exclusions: [] };

/** Reads stored filters, filling fields added later (older saved searches lack them). */
export function parseFilters(json: string): SearchFilters {
  let raw: Partial<SearchFilters> = {};
  try {
    raw = JSON.parse(json) as Partial<SearchFilters>;
  } catch {
    /* fall through to empty */
  }
  const out = { ...EMPTY_FILTERS };
  for (const k of Object.keys(EMPTY_FILTERS) as (keyof SearchFilters)[]) out[k] = Array.isArray(raw[k]) ? raw[k]!.filter((x) => typeof x === "string") : [];
  return out;
}

const q = (t: string) => (/[\s()"]/.test(t) ? `"${t.replace(/"/g, "")}"` : t);
const group = (terms: string[], op: "OR" | "AND") => (terms.length === 1 ? q(terms[0]) : `(${terms.map(q).join(` ${op} `)})`);

/** Generic Boolean. Each source renders its own syntax; this one is for review and export. */
export function toBoolean(f: SearchFilters): string {
  const parts: string[] = [];
  const titles = [...f.titles, ...f.adjacent_titles];
  if (titles.length) parts.push(group(titles, "OR"));
  for (const k of f.keywords) parts.push(q(k));
  for (const s of f.skills_required) parts.push(q(s));
  if (f.skills_preferred.length) parts.push(`${group(f.skills_preferred, "OR")}`);
  let out = parts.join(" AND ");
  if (f.exclusions.length) out += ` NOT ${group(f.exclusions, "OR")}`;
  return out;
}

export function parseList(v: string): string[] {
  return Array.from(new Set(v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))).slice(0, 30);
}
