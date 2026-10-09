// Criteria-alignment score (method "alignment-v1"). Pure and deterministic: computed by
// Talyn from per-criterion results (with recruiter corrections applied), never by the AI.
//
//   weight:  required (essential) = 2, preferred = 1 by default — editable per role
//   credit:  supported = 1, partially supported = 0.5, inferred = 0.5, confirmed not met (recruiter) = 0
//   not assessable: not stated, conflicting  → excluded from the score, reduce coverage
//   excluded entirely: skills (counted separately as "X/Y required skills evidenced", see
//   skills.ts) and informational criteria (shown, never weighted)
//
//   score    = Σ(weight × credit) / Σ(weight of assessable criteria) × 100
//   coverage = Σ(weight of assessable criteria) / Σ(weight of all criteria)
//
// The score is withheld when coverage < 60% or fewer than half of the essential
// criteria are assessable, and flagged "limited" when coverage < 80%.
// It measures alignment with the approved criteria only — not candidate quality,
// likelihood of hire, or any validated prediction.

export const SCORE_METHOD = "alignment-v1";
export const WEIGHTS = { essential: 2, preferred: 1 } as const;
export const CREDIT: Record<string, number | null> = {
  supported: 1,
  partially_supported: 0.5,
  inferred: 0.5,
  conflicting: null,
  not_stated: null,
  confirmed_absent: 0,
};
export const MIN_COVERAGE = 0.6;
export const LIMITED_COVERAGE = 0.8;
export const MIN_ESSENTIAL_ASSESSABLE = 0.5;

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

export function computeScore(all: ScoreInput[], weights: Weights = WEIGHTS): ScoreResult {
  const items = all.filter((i) => i.kind !== "skill" && i.importance !== "informational");
  const rows: ScoreRow[] = items.map((i) => {
    const result = i.overrideResult ?? i.result;
    const weight = i.importance === "preferred" ? weights.preferred : weights.essential;
    const credit = CREDIT[result] ?? null;
    return { name: i.name, importance: i.importance, result, weight, credit, points: credit === null ? null : weight * credit };
  });
  const totalWeight = rows.reduce((n, r) => n + r.weight, 0);
  const assessable = rows.filter((r) => r.credit !== null);
  const assessedWeight = assessable.reduce((n, r) => n + r.weight, 0);
  const points = assessable.reduce((n, r) => n + (r.points ?? 0), 0);
  const essential = rows.filter((r) => r.importance !== "preferred");
  const essentialAssessable = essential.filter((r) => r.credit !== null).length;
  const coverage = totalWeight ? assessedWeight / totalWeight : 0;
  if (assessedWeight === 0 && rows.length) return { method: SCORE_METHOD, rows, coverage: 0, essentialAssessable, essentialTotal: essential.length, weights, score: null, status: "withheld", reason: "Score withheld: no weighted criterion has assessable evidence." };

  const base = { method: SCORE_METHOD, rows, coverage, essentialAssessable, essentialTotal: essential.length, weights };
  if (rows.length === 0) return { ...base, score: null, status: "none", reason: "No weighted evaluation criteria were assessed." };
  if (coverage < MIN_COVERAGE || (essential.length > 0 && essentialAssessable / essential.length < MIN_ESSENTIAL_ASSESSABLE)) {
    return {
      ...base,
      score: null,
      status: "withheld",
      reason: `Score withheld: evidence covers ${pct(coverage)} of the weighted criteria and ${essentialAssessable} of ${essential.length} essential criteria. Gather more information before relying on a score.`,
    };
  }
  const score = Math.round((points / assessedWeight) * 100);
  return {
    ...base,
    score,
    status: coverage < LIMITED_COVERAGE ? "limited" : "ok",
    reason:
      coverage < LIMITED_COVERAGE
        ? `Limited evidence: the score covers only ${pct(coverage)} of the weighted criteria.`
        : `Score covers ${pct(coverage)} of the weighted criteria.`,
  };
}

export function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

export function scoreSummaryText(s: ScoreResult) {
  return s.score === null
    ? `${s.reason}`
    : `Criteria-alignment score ${s.score}/100 (method ${s.method}; on assessable criteria only). Evidence coverage ${pct(s.coverage)}; ${s.essentialAssessable}/${s.essentialTotal} essential criteria assessable.`;
}
