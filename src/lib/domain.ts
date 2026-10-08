// Shared domain vocabulary. Safe to import from client and server code.

export const ROLE_STATUSES = ["draft", "open", "on_hold", "closed"] as const;
export type RoleStatus = (typeof ROLE_STATUSES)[number];
export const ROLE_STATUS_LABEL: Record<RoleStatus, string> = {
  draft: "Draft",
  open: "Open",
  on_hold: "On hold",
  closed: "Closed",
};

export const EMPLOYMENT_TYPES = ["full_time", "part_time", "contract", "temporary", "internship"] as const;
export type EmploymentType = (typeof EMPLOYMENT_TYPES)[number];
export const EMPLOYMENT_TYPE_LABEL: Record<EmploymentType, string> = {
  full_time: "Full-time",
  part_time: "Part-time",
  contract: "Contract",
  temporary: "Temporary",
  internship: "Internship",
};

export const STAGES = [
  "new",
  "in_review",
  "recruiter_screen",
  "hiring_team_review",
  "interview",
  "offer",
  "hired",
  "rejected",
] as const;
export type Stage = (typeof STAGES)[number];
export const STAGE_LABEL: Record<Stage, string> = {
  new: "New",
  in_review: "In review",
  recruiter_screen: "Recruiter screen",
  hiring_team_review: "Hiring team review",
  interview: "Interview",
  offer: "Offer",
  hired: "Hired",
  rejected: "Rejected",
};

export const IMPORTANCE = ["essential", "preferred"] as const;
export type Importance = (typeof IMPORTANCE)[number];

export const CRITERION_STATUSES = ["proposed", "approved", "rejected"] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export const CRITERION_ORIGIN_LABEL: Record<string, string> = {
  manual: "Added by recruiter",
  ai: "Proposed by AI",
  extracted: "Extracted from JD (no AI)",
};

export const RESULTS = ["supported", "partially_supported", "inferred", "conflicting", "not_stated"] as const;
export type AssessmentResult = (typeof RESULTS)[number];
export const RESULT_LABEL: Record<AssessmentResult, string> = {
  supported: "Supported",
  partially_supported: "Partially supported",
  inferred: "Inferred",
  conflicting: "Conflicting evidence",
  not_stated: "Not stated",
};
export const RESULT_HELP: Record<AssessmentResult, string> = {
  supported: "Directly and fully stated in the CV or candidate-provided information.",
  partially_supported: "Part of the criterion is stated; part is missing.",
  inferred: "Not stated outright; a reasonable reading of related evidence. Verify.",
  conflicting: "The material contradicts itself on this criterion. Clarify with the candidate.",
  not_stated: "No evidence found. This is missing information, not proof the candidate lacks it.",
};

export const RECOMMENDATIONS = ["advance_to_review", "gather_more_info", "insufficient_evidence"] as const;
export type Recommendation = (typeof RECOMMENDATIONS)[number];
export const RECOMMENDATION_LABEL: Record<Recommendation, string> = {
  advance_to_review: "Advance to the next human review",
  gather_more_info: "Gather more information",
  insufficient_evidence: "Does not currently show enough evidence for the approved criteria",
};

export const CONFIDENCE = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export const DECISIONS = ["advance", "hold", "decline"] as const;
export type Decision = (typeof DECISIONS)[number];
export const DECISION_LABEL: Record<Decision, string> = {
  advance: "Advance",
  hold: "Hold",
  decline: "Decline",
};

// Provenance of profile fields. "Confirmed" means a recruiter reviewed and accepted the
// AI/parser extraction — never that the fact itself was independently verified.
export const ORIGIN_LABEL: Record<string, string> = {
  cv: "From CV · confirmed by recruiter",
  cv_corrected: "From CV · corrected by recruiter",
  recruiter: "Entered by recruiter",
  sourced: "From sourcing provider",
};

export const CORRECTION_REASONS = [
  { value: "extracted_incorrectly", label: "Extracted incorrectly" },
  { value: "incomplete", label: "Incomplete" },
  { value: "out_of_date", label: "Out of date" },
  { value: "clarified_with_candidate", label: "Clarified with candidate" },
  { value: "wording", label: "Wording or formatting" },
  { value: "other", label: "Other" },
] as const;
export const CORRECTION_REASON_LABEL: Record<string, string> = Object.fromEntries(CORRECTION_REASONS.map((r) => [r.value, r.label]));

export const GENERATOR_LABEL: Record<string, string> = {
  ai: "AI assessment",
  keyword: "Keyword check (not AI)",
  manual: "Manual assessment",
};

export type EvidenceSource = "resume" | "profile";
export type Evidence = {
  quote: string;
  source: EvidenceSource;
  page?: number | null;
  section?: string | null;
  /** True when the quote was found verbatim (whitespace/case-insensitive) in the source text. */
  verified: boolean;
};

export function isOneOf<T extends readonly string[]>(list: T, v: unknown): v is T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}
