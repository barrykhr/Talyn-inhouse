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
/** Evaluation criteria may also be informational: shown and assessed, never weighted. */
export const CRITERION_IMPORTANCE = ["essential", "preferred", "informational"] as const;
export const IMPORTANCE_LABEL: Record<string, string> = { essential: "Required", preferred: "Preferred", informational: "Informational" };
export const CRITERION_KINDS = ["skill", "criterion"] as const;
export type CriterionKind = (typeof CRITERION_KINDS)[number];
export type Importance = (typeof IMPORTANCE)[number];

export const CRITERION_STATUSES = ["proposed", "approved", "rejected"] as const;
export type CriterionStatus = (typeof CRITERION_STATUSES)[number];

export const CRITERION_ORIGIN_LABEL: Record<string, string> = {
  manual: "Added by recruiter",
  ai: "Proposed by AI",
  extracted: "Extracted from JD (no AI)",
};

export const RESULTS = ["supported", "partially_supported", "inferred", "conflicting", "not_stated", "confirmed_absent"] as const;
/** What the assessment engine (AI or keyword check) may return. "confirmed_absent" is recruiter-only. */
export const ENGINE_RESULTS = ["supported", "partially_supported", "inferred", "conflicting", "not_stated"] as const;
export type AssessmentResult = (typeof RESULTS)[number];
export const RESULT_LABEL: Record<AssessmentResult, string> = {
  supported: "Supported",
  partially_supported: "Partially supported",
  inferred: "Inferred",
  conflicting: "Conflicting evidence",
  not_stated: "Not stated",
  confirmed_absent: "Confirmed not met (recruiter)",
};
export const RESULT_HELP: Record<AssessmentResult, string> = {
  supported: "Directly and fully stated in the CV or candidate-provided information.",
  partially_supported: "Part of the criterion is stated; part is missing.",
  inferred: "Not stated outright; a reasonable reading of related evidence. Verify.",
  conflicting: "The material contradicts itself on this criterion. Clarify with the candidate.",
  not_stated: "No evidence found. This is missing information, not proof the candidate lacks it.",
  confirmed_absent: "A recruiter confirmed this is not met (for example, with the candidate). Only a recruiter can set this.",
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
// Recruiter decisions. "advance" = Shortlist (wants to progress), "decline" = Reject. Always recorded by a recruiter.
export const DECISION_LABEL: Record<Decision, string> = {
  advance: "Shortlist",
  hold: "Hold",
  decline: "Reject",
};

/** Required, job-related reasons when a recruiter rejects. */
export const REJECT_REASONS = [
  { value: "missing_essential", label: "Missing essential criteria" },
  { value: "insufficient_evidence", label: "Not enough evidence for the criteria" },
  { value: "location_or_eligibility", label: "Location or work eligibility" },
  { value: "seniority", label: "Seniority doesn't match the role" },
  { value: "compensation", label: "Compensation expectations" },
  { value: "role_filled_or_closed", label: "Role filled or closed" },
  { value: "candidate_withdrew", label: "Candidate withdrew" },
  { value: "duplicate", label: "Duplicate record" },
  { value: "other", label: "Other (explain in note)" },
] as const;
export const REJECT_REASON_LABEL: Record<string, string> = Object.fromEntries(REJECT_REASONS.map((r) => [r.value, r.label]));

/** How a person came to this role. Never merged: applicants and discovered people stay distinct. */
export const APP_ORIGIN_LABEL: Record<string, string> = { applied: "Applied", discovered: "Discovered" };

/** Three-way reading of a criterion result for quick review. The detailed result stays visible. */
export type EvidenceTier = "found" | "uncertain" | "missing";
export const EVIDENCE_TIER: Record<AssessmentResult, EvidenceTier> = {
  supported: "found",
  partially_supported: "uncertain",
  inferred: "uncertain",
  conflicting: "uncertain",
  not_stated: "missing",
  confirmed_absent: "missing",
};
export const EVIDENCE_TIER_LABEL: Record<EvidenceTier, string> = { found: "Evidence found", uncertain: "Uncertain", missing: "Missing" };

// Provenance of profile fields. "Confirmed" means a recruiter reviewed and accepted the
// AI/parser extraction — never that the fact itself was independently verified.
export const ORIGIN_LABEL: Record<string, string> = {
  cv: "From CV · confirmed by recruiter",
  cv_corrected: "From CV · corrected by recruiter",
  recruiter: "Entered by recruiter",
  sourced: "From sourcing provider",
  ats: "From ATS",
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

export type EvidenceSource = "resume" | "profile" | "source";
export type Evidence = {
  quote: string;
  /** resume = the CV on file; profile = candidate-provided information; source = the linked Discover source record. */
  source: EvidenceSource;
  page?: number | null;
  section?: string | null;
  /** Where the evidence came from, e.g. the CV file name or the source name. */
  origin?: string | null;
  /** ISO date the material was added or retrieved. */
  date?: string | null;
  /** Link to the source record, for linked source evidence. */
  url?: string | null;
  /** True when the quote was found verbatim (whitespace/case-insensitive) in the source text. */
  verified: boolean;
};

export function isOneOf<T extends readonly string[]>(list: T, v: unknown): v is T[number] {
  return typeof v === "string" && (list as readonly string[]).includes(v);
}

// ---------------------------------------------------------------- Phase 2: sourcing

export const ICP_CATEGORIES = [
  { key: "target_title", label: "Target titles", hint: "Titles that match the role directly" },
  { key: "adjacent_title", label: "Adjacent titles", hint: "Synonyms and closely related titles" },
  { key: "skill_essential", label: "Essential skills", hint: "From essential criteria" },
  { key: "skill_preferred", label: "Preferred skills", hint: "Nice to have" },
  { key: "experience", label: "Experience", hint: "Relevant experience and scope" },
  { key: "seniority", label: "Seniority", hint: "Level of the role" },
  { key: "industry", label: "Industries & company contexts", hint: "Where relevant experience is often found" },
  { key: "location", label: "Location", hint: "Geography constraints stated for the role" },
  { key: "work_model", label: "Work model", hint: "Onsite, hybrid or remote" },
  { key: "transferable", label: "Transferable backgrounds", hint: "Non-obvious backgrounds worth considering" },
  { key: "exclusion", label: "Exclusions", hint: "Job-related only, and only when you approve them" },
] as const;
export type IcpCategory = (typeof ICP_CATEGORIES)[number]["key"];
export const ICP_ORIGIN_LABEL: Record<string, string> = {
  jd: "Stated in the JD",
  criteria: "From approved criteria",
  ai_inferred: "Inferred by AI",
  recruiter: "Added by recruiter",
};
