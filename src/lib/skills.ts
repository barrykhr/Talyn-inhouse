import { isStale } from "./summary";

// Evidence-backed skill matching. Pure and deterministic — safe on client and server.
//
// Each required/preferred skill gets one status from the latest assessment, with recruiter
// corrections applied:
//   supported            → Evidence found
//   partially_supported  → Partial evidence
//   not_stated           → No evidence found      (missing evidence, NOT proof of absence)
//   inferred/conflicting → Needs recruiter review
//   confirmed_absent     → Confirmed not present  (only a recruiter can set this)
//
// Count  = required skills with "Evidence found" (+ "Partial evidence" only when the recruiter
//          turns on partial credit for the role).
// Threshold state compares the count with the recruiter-configured minimum:
//   Meets            count ≥ threshold
//   Needs review     the outcome depends on skills still awaiting review, the assessment is out of
//                    date, there was nothing to assess, or the threshold can't be applied
//   Below            count + unresolved < threshold
// The count is never the candidate's evaluation, never a decision, and never hides, rejects or
// advances anyone.

export const SKILL_STATUSES = ["evidence_found", "partial", "no_evidence", "needs_review", "confirmed_absent"] as const;
export type SkillStatus = (typeof SKILL_STATUSES)[number];

export const SKILL_STATUS_LABEL: Record<SkillStatus, string> = {
  evidence_found: "Evidence found",
  partial: "Partial evidence",
  no_evidence: "No evidence found",
  needs_review: "Needs recruiter review",
  confirmed_absent: "Confirmed not present",
};
export const SKILL_STATUS_HELP: Record<SkillStatus, string> = {
  evidence_found: "The candidate's own material shows this skill. Check the excerpt.",
  partial: "Some of the skill is shown, or only indirectly. Not counted unless partial credit is on.",
  no_evidence: "Nothing in the CV, profile or linked source mentions it. This is missing information — not proof they lack the skill.",
  needs_review: "The evidence is indirect, conflicting or couldn't be verified. A recruiter decides.",
  confirmed_absent: "A recruiter confirmed the candidate doesn't have this skill (for example, from a conversation).",
};

/** The assessment result a recruiter picks when correcting a skill. */
export const SKILL_STATUS_RESULT: Record<Exclude<SkillStatus, "needs_review">, string> = {
  evidence_found: "supported",
  partial: "partially_supported",
  no_evidence: "not_stated",
  confirmed_absent: "confirmed_absent",
};

export function skillStatus(result: string): SkillStatus {
  switch (result) {
    case "supported":
      return "evidence_found";
    case "partially_supported":
      return "partial";
    case "not_stated":
      return "no_evidence";
    case "confirmed_absent":
      return "confirmed_absent";
    default:
      return "needs_review"; // inferred, conflicting, anything unexpected
  }
}

export type ThresholdState = "meets" | "below" | "needs_review" | "not_assessed" | "no_threshold" | "no_skills";
export const THRESHOLD_LABEL: Record<ThresholdState, string> = {
  meets: "Meets configured skill threshold",
  below: "Below configured skill threshold",
  needs_review: "Needs review",
  not_assessed: "Not assessed",
  no_threshold: "No threshold set",
  no_skills: "No required skills",
};
export const THRESHOLD_SHORT: Record<ThresholdState, string> = {
  meets: "Meets threshold",
  below: "Below threshold",
  needs_review: "Needs review",
  not_assessed: "Not assessed",
  no_threshold: "No threshold",
  no_skills: "No skills set",
};

export type SkillItem = { criterionId: string | null; kind?: string; importance: string; result: string; overrideResult: string | null };
export type RoleSkillConfig = {
  requiredSkillIds: string[];
  preferredSkillIds: string[];
  threshold: number | null;
  partialCredit: boolean;
};

export type SkillMatch = {
  state: ThresholdState;
  /** Required skills counted toward the threshold. null when there's nothing to count honestly. */
  evidenced: number | null;
  required: number;
  preferredEvidenced: number | null;
  preferred: number;
  partial: number;
  needsReview: number;
  noEvidence: number;
  confirmedAbsent: number;
  unassessed: number;
  threshold: number | null;
  partialCredit: boolean;
  stale: boolean;
  /** No CV, candidate-provided information or linked source to assess. */
  noMaterial: boolean;
  reason: string;
};

/** "5/6" — or "—/6" when there's no honest count. */
export function countLabel(m: Pick<SkillMatch, "evidenced" | "required">) {
  return `${m.evidenced ?? "—"}/${m.required}`;
}

export function skillMatch(input: {
  items: SkillItem[] | null; // latest assessment items, or null when not assessed
  config: RoleSkillConfig;
  stale: boolean; // assessed against older criteria or older candidate information
  noMaterial: boolean; // no CV, candidate-provided information or linked source text to assess
}): SkillMatch {
  const { config } = input;
  const required = config.requiredSkillIds.length;
  const preferred = config.preferredSkillIds.length;
  const base = {
    required,
    preferred,
    threshold: config.threshold,
    partialCredit: config.partialCredit,
    stale: input.stale,
    noMaterial: input.noMaterial && !input.items,
    partial: 0,
    needsReview: 0,
    noEvidence: 0,
    confirmedAbsent: 0,
    unassessed: 0,
  };
  if (required === 0)
    return { ...base, state: "no_skills", evidenced: null, preferredEvidenced: null, reason: "This role has no approved required skills." };
  if (!input.items) {
    if (input.noMaterial)
      return { ...base, state: "needs_review", evidenced: null, preferredEvidenced: null, unassessed: required, reason: "No CV, candidate-provided information or linked source evidence to assess. Add material or review manually — no count is shown." };
    return { ...base, state: "not_assessed", evidenced: null, preferredEvidenced: null, unassessed: required, reason: "Not assessed yet. Use Reassess candidates." };
  }

  const byId = new Map<string, SkillStatus>();
  for (const i of input.items) if (i.criterionId && i.kind === "skill") byId.set(i.criterionId, skillStatus(i.overrideResult ?? i.result));

  const counts = { evidenced: 0, partial: 0, needsReview: 0, noEvidence: 0, confirmedAbsent: 0, unassessed: 0 };
  for (const id of config.requiredSkillIds) {
    const st = byId.get(id);
    if (!st) counts.unassessed++;
    else if (st === "evidence_found") counts.evidenced++;
    else if (st === "partial") {
      counts.partial++;
      if (config.partialCredit) counts.evidenced++;
    } else if (st === "needs_review") counts.needsReview++;
    else if (st === "no_evidence") counts.noEvidence++;
    else counts.confirmedAbsent++;
  }
  const preferredEvidenced = config.preferredSkillIds.filter((id) => {
    const st = byId.get(id);
    return st === "evidence_found" || (config.partialCredit && st === "partial");
  }).length;

  const out = { ...base, ...counts, preferredEvidenced };
  const evidenceWord = config.partialCredit ? "evidence found or partial evidence" : "evidence found";
  const countText = `${counts.evidenced} of ${required} required skills have ${evidenceWord}`;

  if (input.stale)
    return { ...out, state: "needs_review", reason: `${countText}, but the assessment predates changes to the role's skills or the candidate's information. Reassess to update.` };
  if (counts.unassessed)
    return { ...out, state: "needs_review", reason: `${counts.unassessed} required skill${counts.unassessed === 1 ? " was" : "s were"} added after this assessment. Reassess to include ${counts.unassessed === 1 ? "it" : "them"}.` };
  if (config.threshold == null) return { ...out, state: "no_threshold", reason: `${countText}. No minimum is configured for this role.` };
  if (config.threshold > required)
    return { ...out, state: "needs_review", reason: `The threshold (${config.threshold}) is higher than the number of required skills (${required}). Update it on the Criteria tab.` };
  if (counts.evidenced >= config.threshold) return { ...out, state: "meets", reason: `${countText}; the configured minimum is ${config.threshold}.` };
  if (counts.evidenced + counts.needsReview >= config.threshold)
    return { ...out, state: "needs_review", reason: `${countText}; ${counts.needsReview} more need${counts.needsReview === 1 ? "s" : ""} recruiter review, which decides whether the minimum of ${config.threshold} is met.` };
  return {
    ...out,
    state: "below",
    reason: `${countText}; the configured minimum is ${config.threshold}.${counts.noEvidence ? ` ${counts.noEvidence} ${counts.noEvidence === 1 ? "has" : "have"} no evidence found — that is missing information, not proof the candidate lacks ${counts.noEvidence === 1 ? "it" : "them"}.` : ""}`,
  };
}

/** Role skill configuration from its approved criteria. */
export function roleSkillConfig(
  role: { skillThreshold: number | null; skillPartialCredit: boolean },
  criteria: { id: string; kind: string; importance: string; status: string }[],
): RoleSkillConfig {
  const skills = criteria.filter((c) => c.kind === "skill" && c.status === "approved");
  return {
    requiredSkillIds: skills.filter((c) => c.importance !== "preferred").map((c) => c.id),
    preferredSkillIds: skills.filter((c) => c.importance === "preferred").map((c) => c.id),
    threshold: role.skillThreshold,
    partialCredit: role.skillPartialCredit,
  };
}

/** Candidate-provided information used as evidence (never recruiter notes). */
export function profileEvidenceText(c: { currentTitle: string | null; currentCompany: string | null; candidateSummary: string | null }) {
  return [c.currentTitle ? `Current title: ${c.currentTitle}` : "", c.currentCompany ? `Current company: ${c.currentCompany}` : "", c.candidateSummary ?? ""].filter(Boolean).join("\n");
}

/** Short fingerprint (FNV-1a) of the profile text an assessment used, to detect later edits. */
export function profileFingerprint(text: string) {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16);
}

/** Whether an assessment is older than the candidate's current material (CV or candidate-provided information). */
export function candidateInfoChanged(
  a: { resumeId: string | null; profileHash: string | null },
  current: { resumeId: string | null; candidate: { currentTitle: string | null; currentCompany: string | null; candidateSummary: string | null } },
) {
  if ((a.resumeId ?? null) !== (current.resumeId ?? null)) return true;
  return a.profileHash != null && a.profileHash !== profileFingerprint(profileEvidenceText(current.candidate));
}

export const THRESHOLD_FILTERS = ["meets", "below", "needs_review", "not_assessed"] as const;

/** Skill match for one application, from its latest assessment and the role's current state. */
export function matchForApplication(
  a: {
    sourcedProfileId: string | null;
    candidate: { currentTitle: string | null; currentCompany: string | null; candidateSummary: string | null; resumes?: { id: string }[] };
    assessments: { criteriaSnapshot: string; criteriaVersion: number | null; resumeId: string | null; profileHash: string | null; items: SkillItem[] }[];
  },
  ctx: { config: RoleSkillConfig; approved: { id: string; updatedAt: Date }[]; criteriaVersion: number },
): SkillMatch {
  const latest = a.assessments[0] ?? null;
  const resumeId = a.candidate.resumes?.[0]?.id ?? null;
  const stale =
    !!latest &&
    (isStale(latest.criteriaSnapshot, ctx.approved) ||
      (latest.criteriaVersion != null && latest.criteriaVersion !== ctx.criteriaVersion) ||
      candidateInfoChanged(latest, { resumeId, candidate: a.candidate }));
  const noMaterial = !resumeId && !a.candidate.candidateSummary && !a.candidate.currentTitle && !a.sourcedProfileId;
  return skillMatch({ items: latest?.items ?? null, config: ctx.config, stale, noMaterial });
}

/** Applies the list filters: threshold status and a minimum required-skill count. Filters only narrow a view — they never hide anyone from the role. */
export function passesSkillFilter(m: SkillMatch | undefined, f: { skills: string; minskills: string }) {
  if (!f.skills && !f.minskills) return true;
  if (!m) return false;
  if (f.skills && m.state !== f.skills) return false;
  if (f.minskills && (m.evidenced === null || m.evidenced < Number(f.minskills))) return false;
  return true;
}
