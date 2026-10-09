// Review status shown in Applicants / Shortlist. Derived from what recruiters recorded — never from AI output.
import { EVIDENCE_TIER, type AssessmentResult, type EvidenceTier } from "./domain";

export const REVIEW_STATUSES = ["not_reviewed", "assessment_ready", "reviewed", "shortlisted", "on_hold", "rejected"] as const;
export type ReviewStatus = (typeof REVIEW_STATUSES)[number];
export const REVIEW_STATUS_LABEL: Record<ReviewStatus, string> = {
  not_reviewed: "Not reviewed",
  assessment_ready: "Assessment ready",
  reviewed: "Reviewed · no decision",
  shortlisted: "Shortlisted",
  on_hold: "On hold",
  rejected: "Rejected",
};
export const REVIEW_STATUS_TONE: Record<ReviewStatus, "neutral" | "signal" | "ok" | "warn" | "danger" | "gap"> = {
  not_reviewed: "neutral",
  assessment_ready: "signal",
  reviewed: "gap",
  shortlisted: "ok",
  on_hold: "warn",
  rejected: "danger",
};

export function reviewStatus(a: { decision: string | null; assessments: { status: string }[] }): ReviewStatus {
  if (a.decision === "advance") return "shortlisted";
  if (a.decision === "hold") return "on_hold";
  if (a.decision === "decline") return "rejected";
  const latest = a.assessments[0];
  if (!latest) return "not_reviewed";
  return latest.status === "reviewed" ? "reviewed" : "assessment_ready";
}

/** Counts of evidence found / uncertain / missing in the latest assessment (recruiter corrections applied). */
export function evidenceCounts(items: { result: string; overrideResult: string | null }[]) {
  const c: Record<EvidenceTier, number> = { found: 0, uncertain: 0, missing: 0 };
  for (const i of items) {
    const t = EVIDENCE_TIER[(i.overrideResult ?? i.result) as AssessmentResult];
    if (t) c[t]++;
  }
  return c;
}
