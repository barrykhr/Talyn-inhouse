// Must-haves: criteria a recruiter marked as non-negotiable. Ordering only — clearly lacking a
// must-have puts someone below everyone who doesn't. Nobody is hidden or rejected because of it.

export type MustHaveState = "met" | "unconfirmed" | "missing" | "none";
export const MUST_HAVE_LABEL: Record<MustHaveState, string> = {
  met: "Meets all must-haves",
  unconfirmed: "Must-haves not all confirmed",
  missing: "Lacks a must-have",
  none: "",
};
/** Lower sorts first. */
export const MUST_HAVE_TIER: Record<MustHaveState, number> = { met: 0, none: 0, unconfirmed: 1, missing: 2 };

const MET = new Set(["supported"]);
// Only evidence against the criterion counts as missing; silence is "not confirmed".
const MISSING = new Set(["confirmed_absent", "conflicting"]);

export type MustHave = { id: string; name: string };
export type MustHaveResult = { state: MustHaveState; missing: string[]; unconfirmed: string[] };

/** From an assessment's items (recruiter overrides win). */
export function mustHaveFromAssessment(mustHaves: MustHave[], items: { criterionId: string | null; criterionName: string; result: string; overrideResult: string | null }[] | null): MustHaveResult {
  if (!mustHaves.length) return { state: "none", missing: [], unconfirmed: [] };
  if (!items) return { state: "unconfirmed", missing: [], unconfirmed: mustHaves.map((m) => m.name) };
  const missing: string[] = [];
  const unconfirmed: string[] = [];
  for (const m of mustHaves) {
    const it = items.find((i) => i.criterionId === m.id) ?? items.find((i) => i.criterionName.trim().toLowerCase() === m.name.trim().toLowerCase());
    const r = it ? (it.overrideResult ?? it.result) : null;
    if (r && MET.has(r)) continue;
    if (r && MISSING.has(r)) missing.push(m.name);
    else unconfirmed.push(m.name);
  }
  return { state: missing.length ? "missing" : unconfirmed.length ? "unconfirmed" : "met", missing, unconfirmed };
}

/** From a Discover result's skill signals: a must-have skill (or one of its aliases) with evidence counts as met. Public profiles can't show absence, so the worst is "not confirmed". */
export function mustHaveFromSignals(mustSkills: { name: string; aliases: string }[], signals: { term: string; matched: boolean }[]): MustHaveResult {
  if (!mustSkills.length) return { state: "none", missing: [], unconfirmed: [] };
  const hit = new Set(signals.filter((s) => s.matched).map((s) => s.term.trim().toLowerCase()));
  const unconfirmed = mustSkills
    .filter((m) => ![m.name, ...m.aliases.split(",")].map((x) => x.trim().toLowerCase()).filter(Boolean).some((t) => hit.has(t)))
    .map((m) => m.name);
  return { state: unconfirmed.length ? "unconfirmed" : "met", missing: [], unconfirmed };
}
