// Role-specific 0–100 profile score (method "profile-v1"). Pure and deterministic — computed by
// Talyn from recruiter-approved, job-related skills and criteria and the evidence on file.
//
//   included:  approved skills and criteria marked Required or Preferred (informational excluded)
//   weight:    Required = role weight (default 2), Preferred = role weight (default 1)
//   credit:    supported = 1 · partially supported = 0.5 · confirmed not present (by a recruiter) = 0
//   unknown:   not stated, inferred, conflicting → left out of the score (never counted as failed)
//              and they lower evidence coverage instead
//   score    = Σ(weight × credit) ÷ Σ(weight of criteria with known evidence) × 100
//   coverage = Σ(weight with known evidence) ÷ Σ(weight of all included criteria)
//   Insufficient evidence when coverage < the version's minimum, or fewer than half the Required
//   items have known evidence. Then no score, colour or recommendation is shown.
//
// Band labels are advisory. They never reject, advance, hide or disposition anyone.

export const PROFILE_METHOD = "profile-v1";
export const PROFILE_CREDIT: Record<string, number | null> = {
  supported: 1,
  partially_supported: 0.5,
  confirmed_absent: 0,
  inferred: null,
  conflicting: null,
  not_stated: null,
};

export type BandKey = "red" | "yellow" | "green";
export type Band = { key: BandKey; min: number; label: string };
export const DEFAULT_BANDS: Band[] = [
  { key: "red", min: 0, label: "Recommendation to reject" },
  { key: "yellow", min: 65, label: "Recommendation to consider" },
  { key: "green", min: 75, label: "AI Screen Pass" },
];
export const BAND_ORDER: BandKey[] = ["red", "yellow", "green"];

/** Bands must start at 0, rise strictly, stay within 0–100 and have labels. Contiguous by construction (each runs to the next min). */
export function validateBands(bands: Band[]): string | null {
  if (bands.length !== 3 || bands.some((b, i) => b.key !== BAND_ORDER[i])) return "There must be exactly three bands: red, yellow, green.";
  if (bands[0].min !== 0) return "The lowest band must start at 0.";
  for (let i = 1; i < bands.length; i++) {
    if (!Number.isFinite(bands[i].min) || bands[i].min <= bands[i - 1].min) return "Each cutoff must be higher than the one below it.";
    if (bands[i].min > 100) return "Cutoffs must be 100 or less.";
  }
  if (bands.some((b) => !b.label.trim() || b.label.length > 60)) return "Every band needs a label of up to 60 characters.";
  return null;
}

export function bandRanges(bands: Band[]) {
  return bands.map((b, i) => ({ ...b, max: i < bands.length - 1 ? bands[i + 1].min : 100, maxInclusive: i === bands.length - 1 }));
}

export function bandFor(score: number, bands: Band[]): Band {
  let out = bands[0];
  for (const b of bands) if (score >= b.min) out = b;
  return out;
}

export type ScoreItem = { criterionName: string; kind: string; importance: string; result: string; overrideResult: string | null; evidenceCount?: number };
export type ProfileRow = { name: string; kind: string; importance: string; result: string; corrected: boolean; weight: number; credit: number | null; points: number | null; evidence: number };
export type ProfileResult = {
  method: string;
  status: "ok" | "insufficient";
  score: number | null;
  coverage: number;
  requiredKnown: number;
  requiredTotal: number;
  band: Band | null;
  rows: ProfileRow[];
  reason: string;
};

export function computeProfileScore(items: ScoreItem[], cfg: { bands: Band[]; weightRequired: number; weightPreferred: number; minCoverage: number }): ProfileResult {
  const rows: ProfileRow[] = items
    .filter((i) => i.importance !== "informational")
    .map((i) => {
      const result = i.overrideResult ?? i.result;
      const weight = i.importance === "preferred" ? cfg.weightPreferred : cfg.weightRequired;
      const credit = PROFILE_CREDIT[result] ?? null;
      return { name: i.criterionName, kind: i.kind, importance: i.importance, result, corrected: !!i.overrideResult, weight, credit, points: credit === null ? null : weight * credit, evidence: i.evidenceCount ?? 0 };
    });
  const total = rows.reduce((n, r) => n + r.weight, 0);
  const known = rows.filter((r) => r.credit !== null);
  const knownWeight = known.reduce((n, r) => n + r.weight, 0);
  const points = known.reduce((n, r) => n + (r.points ?? 0), 0);
  const required = rows.filter((r) => r.importance !== "preferred");
  const requiredKnown = required.filter((r) => r.credit !== null).length;
  const coverage = total ? knownWeight / total : 0;
  const base = { method: PROFILE_METHOD, rows, coverage, requiredKnown, requiredTotal: required.length };
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  if (!rows.length) return { ...base, status: "insufficient", score: null, band: null, reason: "No approved Required or Preferred criteria were assessed." };
  if (knownWeight === 0 || coverage < cfg.minCoverage || (required.length > 0 && requiredKnown / required.length < 0.5))
    return {
      ...base,
      status: "insufficient",
      score: null,
      band: null,
      reason: `Insufficient evidence: known evidence covers ${pct(coverage)} of the weighted criteria (minimum ${pct(cfg.minCoverage)}) and ${requiredKnown} of ${required.length} Required items. Missing evidence is unknown, not a failure.`,
    };
  const score = Math.round((points / knownWeight) * 100);
  return { ...base, status: "ok", score, band: bandFor(score, cfg.bands), reason: `Based on ${known.length} of ${rows.length} criteria with known evidence (coverage ${pct(coverage)}).` };
}

export function parseBands(json: string | null | undefined): Band[] {
  try {
    const b = JSON.parse(json ?? "") as Band[];
    return validateBands(b) ? DEFAULT_BANDS : b;
  } catch {
    return DEFAULT_BANDS;
  }
}

// Criteria that name protected characteristics are refused; proxies need a documented reason.
const PROTECTED = /\b(age|aged|gender|male|female|sex|pregnan\w*|maternity|marital|married|family status|religio\w*|caste|racial|ethnicity|ethnic origin|nationality|national origin|disabilit\w*|disabled|sexual orientation|photo|photograph|native speaker|date of birth|birth ?year)\b/i;
const PROXY = /\b(career gaps?|employment gaps?|gap in|continuous employment|resume format\w*|cv format\w*|writing polish|well[- ]written|top[- ]tier (university|school|college)|ivy league|prestigious|elite (university|school)|recent graduate|digital native|culture fit|linear career)\b/i;

/** Returns a reason to refuse a criterion, or null when it can be used. */
export function criterionFairnessIssue(name: string, description: string): string | null {
  const text = `${name} ${description}`;
  if (PROTECTED.test(text))
    return "This appears to refer to a protected characteristic (such as age, gender, religion, nationality, disability or family status) or a proxy for one. Talyn won't score it. Rephrase it as a job-related requirement, e.g. a specific language proficiency or legal work authorization.";
  if (PROXY.test(text) && !/job-related reason:\s*\S{10,}/i.test(description))
    return "Career gaps, CV formatting, writing polish, school prestige or a particular career path aren't scored unless there's a specific job-related reason. Add “Job-related reason: …” to the description to document and approve it.";
  return null;
}
