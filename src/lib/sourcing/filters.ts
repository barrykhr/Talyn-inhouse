// Structured search filters and a generic Boolean rendering. Pure — safe on client and server.

export type SearchFilters = {
  titles: string[];
  skills_required: string[];
  skills_preferred: string[];
  locations: string[];
  seniority: string[];
  industries: string[];
  exclusions: string[];
};

export const FILTER_LABEL: Record<keyof SearchFilters, string> = {
  titles: "Titles",
  skills_required: "Required skills",
  skills_preferred: "Preferred skills",
  locations: "Locations",
  seniority: "Seniority",
  industries: "Industries / company contexts",
  exclusions: "Exclusions",
};

export const EMPTY_FILTERS: SearchFilters = { titles: [], skills_required: [], skills_preferred: [], locations: [], seniority: [], industries: [], exclusions: [] };

const q = (t: string) => (/[\s()"]/.test(t) ? `"${t.replace(/"/g, "")}"` : t);
const group = (terms: string[], op: "OR" | "AND") => (terms.length === 1 ? q(terms[0]) : `(${terms.map(q).join(` ${op} `)})`);

/** Generic Boolean. Each source renders its own syntax; this one is for review and export. */
export function toBoolean(f: SearchFilters): string {
  const parts: string[] = [];
  if (f.titles.length) parts.push(group(f.titles, "OR"));
  for (const s of f.skills_required) parts.push(q(s));
  if (f.skills_preferred.length) parts.push(`${group(f.skills_preferred, "OR")}`);
  let out = parts.join(" AND ");
  if (f.exclusions.length) out += ` NOT ${group(f.exclusions, "OR")}`;
  return out;
}

export function parseList(v: string): string[] {
  return Array.from(new Set(v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean))).slice(0, 30);
}
