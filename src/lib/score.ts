// Role fit score. Pure and deterministic: computed by Talyn from per-item results (with recruiter
// corrections applied), never by the AI. It is the same calculation as the profile score
// (profile-score.ts, method "profile-v2") over the same skills and criteria, so the two never
// disagree. See profile-score.ts for the credits and the insufficient-evidence rule.
//
// It measures how much of the approved requirements the material shows — not candidate quality,
// likelihood of hire, or any validated prediction.

import { DEFAULT_BANDS, PROFILE_CREDIT, PROFILE_METHOD, computeProfileScore, enoughMaterial } from "./profile-score";

export const SCORE_METHOD = PROFILE_METHOD;
export const WEIGHTS = { essential: 2, preferred: 1 } as const;
export const CREDIT = PROFILE_CREDIT;
/** Coverage under this is flagged as limited evidence. */
export const MIN_COVERAGE = 0.6;
export const LIMITED_COVERAGE = MIN_COVERAGE;

export type ScoreInput = { name: string; importance: string; result: string; overrideResult?: string | null; kind?: string };
export type Weights = { essential: number; preferred: number };
export const weightsOf = (role: { weightRequired?: number | null; weightPreferred?: number | null } | null | undefined): Weights => ({
  essential: role?.weightRequired ?? WEIGHTS.essential,
  preferred: role?.weightPreferred ?? WEIGHTS.preferred,
});

export type ScoreRow = { name: string; importance: string; result: string; weight: number; credit: number | null; points: number | null };

export type ScoreResult = {
  method: string;
  rows: ScoreRow[];
  score: number | null; // 0–100, null when withheld
  status: "ok" | "limited" | "withheld" | "none";
  coverage: number; // 0–1 (weighted)
  essentialAssessable: number;
  essentialTotal: number;
  reason: string;
  weights: Weights;
};

/**
 * `material`: whether the assessment had enough material to judge (see enoughMaterial in
 * profile-score.ts). When unknown, it counts as enough only if some item found evidence.
 */
export function computeScore(all: ScoreInput[], weights: Weights = WEIGHTS, opts: { material?: boolean } = {}): ScoreResult {
  const items = all.filter((i) => i.importance !== "informational");
  const results = items.map((i) => i.overrideResult ?? i.result);
  const material = opts.material ?? results.some((r) => ["supported", "partially_supported", "inferred", "conflicting"].includes(r));
  const r = computeProfileScore(
    items.map((i) => ({ criterionName: i.name, kind: i.kind ?? "criterion", importance: i.importance, result: i.result, overrideResult: i.overrideResult ?? null })),
    { bands: DEFAULT_BANDS, weightRequired: weights.essential, weightPreferred: weights.preferred, minCoverage: MIN_COVERAGE },
    { material },
  );
  const rows: ScoreRow[] = r.rows.map((x) => ({ name: x.name, importance: x.importance, result: x.result, weight: x.weight, credit: x.credit, points: x.points }));
  const base = { method: SCORE_METHOD, rows, coverage: r.coverage, essentialAssessable: r.requiredKnown, essentialTotal: r.requiredTotal, weights, reason: r.reason };
  if (!rows.length) return { ...base, score: null, status: "none" };
  if (r.status === "insufficient") return { ...base, score: null, status: "withheld" };
  return { ...base, score: r.score, status: r.limited || r.conflicts.length ? "limited" : "ok" };
}

type AssessmentForScore = {
  materialChars?: number | null;
  resumeId?: string | null;
  items: { criterionName: string; importance: string; result: string; overrideResult: string | null; kind?: string }[];
};

/** Role fit for a stored assessment, using what it recorded about the material it read. */
export function scoreAssessment(a: AssessmentForScore, weights?: Weights): ScoreResult {
  return computeScore(
    a.items.map((i) => ({ name: i.criterionName, importance: i.importance, result: i.result, overrideResult: i.overrideResult, kind: i.kind })),
    weights,
    { material: enoughMaterial(a, a.items.map((i) => i.overrideResult ?? i.result)) },
  );
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function scoreSummaryText(s: ScoreResult) {
  return s.score === null
    ? `${s.reason}`
    : `Role fit ${s.score}/100 (method ${s.method}; requirements the material doesn't show count as not shown — missing evidence, not proof of absence). Evidence coverage ${pct(s.coverage)}; ${s.essentialAssessable}/${s.essentialTotal} required items have evidence.`;
}
