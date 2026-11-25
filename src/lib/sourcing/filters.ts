// Structured search filters and a generic Boolean rendering. Pure — safe on client and server.

/** Other names for a title or skill ("Go" → ["Golang"]) that count as evidence for it. */
export type Synonyms = Record<string, string[]>;

export type SearchFilters = ListFilters & {
  /** Recruiter-approved alternative names per title or skill. Matching only; never adds requirements. */
  synonyms?: Synonyms;
};

export type ListFilters = {
  keywords: string[]; // the recruiter's search query, as terms
  titles: string[];
  adjacent_titles: string[];
  skills_required: string[];
  skills_preferred: string[];
  locations: string[];
  seniority: string[];
  industries: string[];
  exclusions: string[];
  /** Companies the recruiter chose to source from: evidence and a ranking input, never a hard filter. */
  target_companies: string[];
};

export const FILTER_LABEL: Record<keyof ListFilters, string> = {
  keywords: "Search query",
  titles: "Titles",
  adjacent_titles: "Adjacent titles",
  skills_required: "Required skills",
  skills_preferred: "Preferred skills",
  locations: "Locations",
  seniority: "Seniority",
  industries: "Industries / company contexts",
  exclusions: "Exclusions",
  target_companies: "Target companies",
};

export const EMPTY_FILTERS: ListFilters = { keywords: [], titles: [], adjacent_titles: [], skills_required: [], skills_preferred: [], locations: [], seniority: [], industries: [], exclusions: [], target_companies: [] };

/** Reads stored filters, filling fields added later (older saved searches lack them). */
export function parseFilters(json: string): SearchFilters {
  let raw: Partial<SearchFilters> = {};
  try {
    raw = JSON.parse(json) as Partial<SearchFilters>;
  } catch {
    /* fall through to empty */
  }
  const out: SearchFilters = { ...EMPTY_FILTERS };
  for (const k of Object.keys(EMPTY_FILTERS) as (keyof ListFilters)[]) out[k] = Array.isArray(raw[k]) ? (raw[k] as unknown[]).filter((x): x is string => typeof x === "string") : [];
  if (raw.synonyms && typeof raw.synonyms === "object") out.synonyms = cleanSynonyms(raw.synonyms, null);
  return out;
}

const q = (t: string) => (/[\s()"]/.test(t) ? `"${t.replace(/"/g, "")}"` : t);
const group = (terms: string[], op: "OR" | "AND") => (terms.length === 1 ? q(terms[0]) : `(${terms.map(q).join(` ${op} `)})`);

/** Generic Boolean. Each source renders its own syntax; this one is for review and export. */
export function toBoolean(f: SearchFilters): string {
  const parts: string[] = [];
  const alt = (t: string) => [t, ...(f.synonyms?.[t] ?? [])];
  const titles = Array.from(new Set([...f.titles, ...f.adjacent_titles].flatMap(alt)));
  if (titles.length) parts.push(group(titles, "OR"));
  for (const k of f.keywords) parts.push(q(k));
  for (const s of f.skills_required) parts.push(group(alt(s), "OR"));
  if (f.skills_preferred.length) parts.push(`${group(f.skills_preferred.flatMap(alt), "OR")}`);
  let out = parts.join(" AND ");
  if (f.exclusions.length) out += ` NOT ${group(f.exclusions, "OR")}`;
  // Target companies rank people higher; they don't narrow the search, so they're a preference clause.
  if (f.target_companies.length) out += ` PREFER current_company:${group(f.target_companies, "OR")}`;
  return out;
}

export function parseList(v: string): string[] {
  return Array.from(new Set(v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))).slice(0, 30);
}

/**
 * Keeps only usable alternatives: for terms in `terms` (when given), distinct from the term and each
 * other (case ignored), at most 40 characters and 4 per term, at most 30 terms.
 */
export function cleanSynonyms(raw: unknown, terms: string[] | null): Synonyms {
  const out: Synonyms = {};
  if (!raw || typeof raw !== "object") return out;
  const allowed = terms ? new Map(terms.map((t) => [t.trim().toLowerCase(), t.trim()])) : null;
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (Object.keys(out).length >= 30) break;
    const key = k.trim();
    if (!key) continue;
    const term = allowed ? allowed.get(key.toLowerCase()) : key.slice(0, 80);
    if (!term || !Array.isArray(v)) continue;
    const seen = new Set([term.toLowerCase()]);
    const alts: string[] = [];
    for (const a of v) {
      if (typeof a !== "string") continue;
      const t = a.trim().slice(0, 40);
      if (!t || seen.has(t.toLowerCase())) continue;
      seen.add(t.toLowerCase());
      alts.push(t);
      if (alts.length >= 4) break;
    }
    if (alts.length) out[term] = alts;
  }
  return out;
}

export function parseSynonyms(json: string | null | undefined, terms: string[] | null = null): Synonyms {
  try {
    return cleanSynonyms(JSON.parse(json || "{}"), terms);
  } catch {
    return {};
  }
}
