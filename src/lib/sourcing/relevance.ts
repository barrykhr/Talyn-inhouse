// Relevance of a Discover result to the role's search fields: which required skills have evidence,
// how much public work shows them, and how recent that work is. A review aid for ordering results;
// it never hides, rejects or contacts anyone. Pure functions (no database, no AI).

export type WorkEvidence = {
  /** One line per piece of public work (repository, project, model, paper, answer tag). */
  units: string[];
  /** What a unit is, plural: "repositories", "projects", "models", "papers", "answer tags". */
  unitLabel: string;
  lastActiveAt: string | null;
  /** Stars, downloads, citations or reputation, summed. */
  popularity: number | null;
  popularityLabel: string | null;
};

type SignalLike = { category: string; term: string; matched: boolean; matchedAs?: string };

export type Relevance = {
  score: number; // 0–100
  belowBar: boolean;
  required: { matched: number; total: number; min: number };
  preferred: { matched: number; total: number };
  titleMatched: boolean;
  /** Current company is one of the recruiter's target companies (+10, capped at 100). */
  companyMatched: boolean;
  /** Units of public work mentioning each matched required skill. */
  depth: { term: string; units: number }[];
  unitLabel: string | null;
  lastActiveAt: string | null;
  popularity: number | null;
  popularityLabel: string | null;
  hasWork: boolean;
};

/** Whole-word, case-insensitive mention (same rule as the evidence quotes). */
export function mentions(text: string, term: string): boolean {
  const t = term.trim();
  if (t.length < 2) return false;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "[\\s-]+")}($|[^\\p{L}\\p{N}])`, "iu");
  return re.test(text);
}

/** Default minimum: at least half of the required skills, rounded up. */
export const defaultMinRequired = (total: number) => (total ? Math.ceil(total / 2) : 0);

const recency = (iso: string | null, now: number) => {
  if (!iso || Number.isNaN(Date.parse(iso))) return 0;
  const months = (now - Date.parse(iso)) / (30 * 86400000);
  return months <= 6 ? 1 : months <= 12 ? 0.6 : months <= 24 ? 0.3 : 0;
};

/**
 * Score out of 100:
 *   required skills with evidence  50 (60 when the search has no preferred skills)
 *   title or alternative title       10
 *   preferred skills                 10
 *   depth of public work             15  (units per matched required skill, up to 5)
 *   recent activity                  10  (last 6 months full, 12 months 60%, 24 months 30%)
 *   others using the work             5  (log scale of stars / downloads / citations)
 * Sources without work evidence (CV-style records) are scored on the first three and rescaled.
 * Location is a filter, never points. With no required skills, query keywords and titles stand in.
 * A current company among the recruiter's target companies adds 10 (capped at 100).
 */
export function computeRelevance(signals: SignalLike[], work: WorkEvidence | null, minRequired: number | null, now = Date.now()): Relevance {
  const of = (cat: string) => signals.filter((s) => s.category === cat);
  let req = of("skill_required");
  if (!req.length) req = of("keyword");
  if (!req.length) req = [...of("title"), ...of("adjacent_title")];
  const pref = of("skill_preferred");
  const titles = [...of("title"), ...of("adjacent_title")];
  const reqMatched = req.filter((s) => s.matched);
  const reqCov = req.length ? reqMatched.length / req.length : 0;
  const prefCov = pref.length ? pref.filter((s) => s.matched).length / pref.length : 0;
  const titleMatched = titles.some((s) => s.matched);

  const units = work?.units ?? [];
  const depth = reqMatched.map((s) => ({ term: s.term, units: units.filter((u) => mentions(u, s.term) || (!!s.matchedAs && mentions(u, s.matchedAs))).length }));
  const depthScore = depth.length ? depth.reduce((n, d) => n + Math.min(d.units, 5) / 5, 0) / depth.length : 0;
  const recent = recency(work?.lastActiveAt ?? null, now);
  const pop = work?.popularity ? Math.min(Math.log10(1 + work.popularity) / 3, 1) : 0;

  const reqWeight = pref.length ? 50 : 60;
  const text = reqWeight * reqCov + 10 * (titleMatched ? 1 : 0) + (pref.length ? 10 * prefCov : 0);
  const hasWork = units.length > 0;
  const companyMatched = of("company").some((s) => s.matched);
  const base = hasWork ? text + 15 * depthScore + 10 * recent + 5 * pop : (text / 70) * 100;
  const score = base + (companyMatched ? 10 : 0);

  const min = Math.min(minRequired ?? defaultMinRequired(req.length), req.length);
  return {
    score: Math.round(Math.max(0, Math.min(100, score))),
    belowBar: reqMatched.length < min,
    required: { matched: reqMatched.length, total: req.length, min },
    preferred: { matched: pref.filter((s) => s.matched).length, total: pref.length },
    titleMatched,
    companyMatched,
    depth,
    unitLabel: work?.unitLabel ?? null,
    lastActiveAt: work?.lastActiveAt ?? null,
    popularity: work?.popularity ?? null,
    popularityLabel: work?.popularityLabel ?? null,
    hasWork,
  };
}
