// Discovery brief: the reviewed fields a Discover search is built from. Pure — safe on client and server.

export const WORK_ARRANGEMENTS = ["onsite", "hybrid", "remote"] as const;
export type WorkArrangement = (typeof WORK_ARRANGEMENTS)[number];
export const WORK_ARRANGEMENT_LABEL: Record<WorkArrangement, string> = { onsite: "On-site", hybrid: "Hybrid", remote: "Remote" };

export type BriefFields = {
  roleName: string;
  altTitles: string[];
  skillsRequired: string[];
  skillsPreferred: string[];
  exclusions: string[];
  minYears: number | null;
  maxYears: number | null;
  location: string | null;
  workArrangement: WorkArrangement | null;
};

/**
 * Where a field's value came from. "inferred" = suggested but not found verbatim in the JD;
 * "not_stated" = the JD doesn't say, so the field is empty rather than guessed.
 */
export type ProvStatus = "from_jd" | "inferred" | "not_stated" | "edited" | "manual";
export type Prov = { status: ProvStatus; quote?: string | null; page?: number | null; verified?: boolean; items?: Record<string, { quote: string | null; verified: boolean }> };
export type Provenance = Partial<Record<keyof BriefFields, Prov>>;

export const PROV_LABEL: Record<ProvStatus, string> = {
  from_jd: "From JD",
  inferred: "Suggested — not found word-for-word in the JD",
  not_stated: "Not stated in the JD",
  edited: "Edited by you",
  manual: "Entered by you",
};

export const BRIEF_FIELD_LABEL: Record<keyof BriefFields, string> = {
  roleName: "Role name",
  altTitles: "Alternative titles",
  skillsRequired: "Required skills",
  skillsPreferred: "Preferred skills",
  exclusions: "Exclusions",
  minYears: "Minimum years of experience",
  maxYears: "Maximum years of experience",
  location: "Location",
  workArrangement: "Work arrangement",
};

export const EMPTY_BRIEF: BriefFields = { roleName: "", altTitles: [], skillsRequired: [], skillsPreferred: [], exclusions: [], minYears: null, maxYears: null, location: null, workArrangement: null };

export function splitList(v: string): string[] {
  return Array.from(new Set(v.split(/[,\n;]/).map((s) => s.trim()).filter(Boolean))).slice(0, 40);
}

const q = (t: string) => (/[\s()"]/.test(t) ? `"${t.replace(/"/g, "")}"` : t);
const any = (xs: string[]) => (xs.length === 1 ? q(xs[0]) : `(${xs.map(q).join(" OR ")})`);

/**
 * A readable Boolean from the confirmed fields: titles OR'd, each required skill AND'd, the
 * location AND'd unless the role is remote, exclusions NOT'd. Preferred skills and years are left
 * out on purpose — they would exclude people; they're shown as evidence on each result instead.
 */
export function buildBoolean(f: BriefFields): string {
  const parts: string[] = [];
  const titles = [f.roleName, ...f.altTitles].map((t) => t.trim()).filter(Boolean);
  if (titles.length) parts.push(any(titles));
  for (const s of f.skillsRequired) parts.push(q(s));
  if (f.location && f.workArrangement !== "remote") parts.push(q(f.location));
  let out = parts.join(" AND ");
  if (f.exclusions.length) out += `${out ? " " : ""}NOT ${any(f.exclusions)}`;
  return out;
}

/** Fingerprint of the fields the Boolean is built from, to flag a stale query. */
export function booleanKey(f: BriefFields) {
  return JSON.stringify([f.roleName.trim().toLowerCase(), f.altTitles, f.skillsRequired, f.location, f.workArrangement, f.exclusions]);
}

/** Simple structural check so a hand-edited query is valid before it is sent to a provider. */
export function checkBoolean(qs: string): string | null {
  let depth = 0;
  let quotes = 0;
  for (const ch of qs) {
    if (ch === '"') quotes++;
    else if (ch === "(" && quotes % 2 === 0) depth++;
    else if (ch === ")" && quotes % 2 === 0) depth--;
    if (depth < 0) return "A closing bracket has no opening bracket.";
  }
  if (quotes % 2) return "A quotation mark isn't closed.";
  if (depth) return "A bracket isn't closed.";
  if (/\b(AND|OR|NOT)\s*$/.test(qs.trim())) return "The query ends with an operator.";
  return null;
}
