// Ranking model (consistent across the product). Two distinct concepts:
//
// 1. Role fit — how the available evidence aligns with this role's APPROVED criteria.
//    = the alignment-v1 score of the latest assessment (recruiter corrections applied).
//    Unranked when there's no assessment, the score is withheld, or the criteria changed
//    since. Low-confidence (shown in a band, not a precise position) when evidence is
//    limited or any criterion has conflicting evidence.
//
// 2. Stage readiness — how well supported the candidate is for the NEXT decision in their
//    current stage. A transparent checklist; only compared within the same role AND stage.
//
// Neither ever changes a pipeline stage. Recruiters can sort, filter and override priority.

import { computeScore, pct, type ScoreResult } from "./score";
import { isStale } from "./summary";
import { STAGE_LABEL, type Stage } from "./domain";

export type AssessmentLike = {
  id: string;
  createdAt: Date;
  criteriaSnapshot: string;
  criteriaVersion: number | null;
  status: string;
  recommendation: string | null;
  recommendationStatus: string | null;
  items: { criterionName: string; importance: string; result: string; overrideResult: string | null }[];
};

export type RoleFit = {
  state: "ranked" | "low_confidence" | "unranked";
  score: number | null;
  coverage: number | null;
  updatedAt: Date | null;
  reason: string; // why ranked/unranked/low confidence
  change: string | null; // explanation of a significant change vs the previous assessment
  criteriaVersion: number | null;
};

const scoreOf = (a: AssessmentLike): ScoreResult =>
  computeScore(a.items.map((i) => ({ name: i.criterionName, importance: i.importance, result: i.result, overrideResult: i.overrideResult })));

export function roleFit(assessments: AssessmentLike[], current: { criteria: { id: string; updatedAt: Date }[]; criteriaVersion: number }): RoleFit {
  const [latest, previous] = assessments;
  if (!latest) return { state: "unranked", score: null, coverage: null, updatedAt: null, reason: "Not assessed yet", change: null, criteriaVersion: null };
  const s = scoreOf(latest);
  const stale = isStale(latest.criteriaSnapshot, current.criteria) || (latest.criteriaVersion != null && latest.criteriaVersion !== current.criteriaVersion);
  let change: string | null = null;
  if (previous) {
    const p = scoreOf(previous);
    if (p.score !== null && s.score !== null && Math.abs(s.score - p.score) >= 10)
      change = `${p.score} → ${s.score} after re-assessment${previous.criteriaVersion !== latest.criteriaVersion ? ` (criteria v${previous.criteriaVersion} → v${latest.criteriaVersion})` : ""}`;
    else if ((p.score === null) !== (s.score === null)) change = s.score === null ? `Was ${p.score}; now withheld for incomplete evidence` : `Was withheld; now ${s.score}`;
  }
  const base = { score: s.score, coverage: s.coverage, updatedAt: latest.createdAt, change, criteriaVersion: latest.criteriaVersion };
  if (stale) return { ...base, state: "unranked", reason: "Criteria changed since the assessment — re-run it" };
  if (s.score === null) return { ...base, state: "unranked", reason: `Score withheld: evidence covers ${pct(s.coverage)}` };
  const conflicting = s.rows.some((r) => r.result === "conflicting");
  if (conflicting) return { ...base, state: "low_confidence", reason: "Conflicting evidence on at least one criterion" };
  if (s.status === "limited") return { ...base, state: "low_confidence", reason: `Limited evidence (coverage ${pct(s.coverage)})` };
  return { ...base, state: "ranked", reason: `Coverage ${pct(s.coverage)}` };
}

export type ReadinessCheck = { label: string; met: boolean };
export type Readiness = { stage: string; nextDecision: string; checks: ReadinessCheck[]; met: number; total: number };

const NEXT: Record<string, string> = {
  new: "whether to review",
  in_review: "whether to screen",
  recruiter_screen: "whether to send to the hiring team",
  hiring_team_review: "whether to interview",
  interview: "whether to make an offer",
  offer: "offer outcome",
};

export function stageReadiness(input: {
  stage: string;
  hasCv: boolean;
  profileReviewed: boolean;
  assessment: AssessmentLike | null;
  assessmentCurrent: boolean;
  openRequests: number;
  decision: string | null;
}): Readiness | null {
  if (input.stage === "hired" || input.stage === "rejected") return null;
  const a = input.assessment;
  const checks: ReadinessCheck[] = [
    { label: "CV on file", met: input.hasCv },
    { label: "CV details reviewed", met: input.profileReviewed },
    { label: "Assessment against current criteria", met: !!a && input.assessmentCurrent },
    { label: "Assessment evidence reviewed", met: a?.status === "reviewed" },
    { label: "No open information requests", met: input.openRequests === 0 },
  ];
  const later = ["recruiter_screen", "hiring_team_review", "interview", "offer"];
  if (later.includes(input.stage))
    checks.push({ label: "AI recommendation reviewed", met: !!a && (!a.recommendation || (a.recommendationStatus !== null && a.recommendationStatus !== "pending")) });
  if (["hiring_team_review", "interview", "offer"].includes(input.stage)) checks.push({ label: "Recruiter decision: Shortlist", met: input.decision === "advance" });
  const met = checks.filter((c) => c.met).length;
  return { stage: STAGE_LABEL[input.stage as Stage] ?? input.stage, nextDecision: NEXT[input.stage] ?? "next step", checks, met, total: checks.length };
}

/** Sort comparator for role fit: ranked (desc score), then low-confidence (desc score), then unranked. */
export function compareFit(a: RoleFit, b: RoleFit) {
  const order = { ranked: 0, low_confidence: 1, unranked: 2 } as const;
  return order[a.state] - order[b.state] || (b.score ?? -1) - (a.score ?? -1);
}
