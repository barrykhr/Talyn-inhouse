// Role-specific 0–100 profile score (method "profile-v2"). Pure and deterministic — computed by
// Talyn from recruiter-approved, job-related skills and criteria and the evidence on file. The
// criteria-alignment "role fit" in score.ts uses the same calculation, so the two always agree.
//
//   included:  approved skills and criteria marked Required or Preferred (informational excluded)
//   weight:    Required = role weight (default 2), Preferred = role weight (default 1)
//   credit:    supported = 1 · partially supported, inferred or conflicting = 0.5 ·
//              not shown in the material = 0 · confirmed not present (by a recruiter) = 0
//   score    = Σ(weight × credit) ÷ Σ(weight of all included items) × 100
//   coverage = share of the weight with any evidence in the material
//
//   Insufficient evidence when there is too little material to judge — no CV and only a title or
//   a line or two (under MIN_MATERIAL_CHARS of text). Then no score, colour or recommendation is
//   shown. With enough material, a requirement the material doesn't show lowers the score: that
//   is missing evidence, not proof the candidate lacks it, and every explanation says so.
//   A required item with conflicting evidence caps the band below the top band until a recruiter
//   resolves it. Coverage under the version's minimum is flagged as limited evidence.
//
// Band labels are advisory. They never reject, advance, hide or disposition anyone.

export const PROFILE_METHOD = "profile-v2";
export const MIN_MATERIAL_CHARS = 400;
export const PROFILE_CREDIT: Record<string, number> = {
  supported: 1,
  partially_supported: 0.5,
  inferred: 0.5,
  conflicting: 0.5,
  not_stated: 0,
  confirmed_absent: 0,
};
const EVIDENCED = new Set(["supported", "partially_supported", "inferred", "conflicting"]);

/**
 * Whether an assessment had enough material to judge. `materialChars` is the length of the CV,
 * candidate-provided and linked-source text the assessment read; older assessments that didn't
 * record it count as enough when a CV was on file or any item found evidence.
 */
export function enoughMaterial(a: { materialChars?: number | null; resumeId?: string | null }, results: string[]) {
  if (a.materialChars != null) return a.materialChars >= MIN_MATERIAL_CHARS;
  return !!a.resumeId || results.some((r) => EVIDENCED.has(r));
}

/** A band label never claims AI was used when it wasn't (e.g. "AI Screen Pass" on a keyword check). */
export function bandLabelFor(label: string, generator: string | null | undefined) {
  if (generator === "ai") return label;
  const cleaned = label.replace(/\bAI[- ]?/g, "").replace(/\s{2,}/g, " ").trim();
  return `${cleaned.charAt(0).toUpperCase()}${cleaned.slice(1)} (keyword check)`;
}

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
  limited: boolean;
  conflicts: string[];
  rows: ProfileRow[];
  reason: string;
};

export function computeProfileScore(
  items: ScoreItem[],
  cfg: { bands: Band[]; weightRequired: number; weightPreferred: number; minCoverage: number },
  opts: { material: boolean } = { material: true },
): ProfileResult {
  const rows: ProfileRow[] = items
    .filter((i) => i.importance !== "informational")
    .map((i) => {
      const result = i.overrideResult ?? i.result;
      const weight = i.importance === "preferred" ? cfg.weightPreferred : cfg.weightRequired;
      const credit = PROFILE_CREDIT[result] ?? 0;
      return { name: i.criterionName, kind: i.kind, importance: i.importance, result, corrected: !!i.overrideResult, weight, credit, points: weight * credit, evidence: i.evidenceCount ?? 0 };
    });
  const total = rows.reduce((n, r) => n + r.weight, 0);
  const evidenced = rows.filter((r) => EVIDENCED.has(r.result));
  const coverage = total ? evidenced.reduce((n, r) => n + r.weight, 0) / total : 0;
  const required = rows.filter((r) => r.importance !== "preferred");
  const requiredKnown = required.filter((r) => EVIDENCED.has(r.result) || r.result === "confirmed_absent").length;
  const conflicts = required.filter((r) => r.result === "conflicting").map((r) => r.name);
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  const base = { method: PROFILE_METHOD, rows, coverage, requiredKnown, requiredTotal: required.length, conflicts };
  if (!rows.length) return { ...base, status: "insufficient", score: null, band: null, limited: false, reason: "No approved Required or Preferred criteria were assessed." };
  if (!opts.material)
    return {
      ...base,
      status: "insufficient",
      score: null,
      band: null,
      limited: false,
      reason: "Insufficient evidence: there isn't enough material to judge (no CV, or only a title and a line or two). Gather more information — missing material isn't a failure.",
    };
  const score = Math.round((rows.reduce((n, r) => n + (r.points ?? 0), 0) / total) * 100);
  let band = bandFor(score, cfg.bands);
  const top = cfg.bands[cfg.bands.length - 1];
  if (conflicts.length && band.key === top.key) band = cfg.bands[cfg.bands.length - 2];
  const limited = coverage < cfg.minCoverage;
  const notShown = rows.filter((r) => r.result === "not_stated").length;
  const parts = [
    `The material shows evidence for ${evidenced.length} of ${rows.length} skills and criteria (weighted coverage ${pct(coverage)}).`,
    notShown ? `${notShown} ${notShown === 1 ? "isn't" : "aren't"} shown, which lowers the score — that's missing evidence, not proof the candidate lacks ${notShown === 1 ? "it" : "them"}.` : "",
    conflicts.length ? `Conflicting evidence on ${conflicts.join(", ")} — resolve it before relying on this band.` : "",
    limited ? `Limited evidence (under the ${pct(cfg.minCoverage)} minimum for this role).` : "",
  ];
  return { ...base, status: "ok", score, band, limited, reason: parts.filter(Boolean).join(" ") };
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
const PROTECTED = new RegExp(
  [
    // age, including limits written as numbers ("under 35", "below 30 years old", "25-35 years old")
    String.raw`\b(age|aged|young|youthful|elderly|millennials?|gen ?z|date of birth|birth ?year)\b`,
    String.raw`\b(under|below|over|above|less than|not more than|max(imum)?|min(imum)?)\s+(the\s+age\s+of\s+)?\d{2}(\s*(years?|yrs?)\s*(old|of age))?\s*($|[,.;:)!])`,
    String.raw`\b\d{2}\s*(-|to|–)\s*\d{2}\s*(years?|yrs?)\s*(old|of age)\b`,
    String.raw`\b\d{2}\s*(years?|yrs?)\s*(old|of age)\b`,
    // sex, gender, family status
    String.raw`\b(gender|male|males|female|females|men|women|boys|girls|ladies|sex|pregnan\w*|maternity|paternity|marital|married|unmarried|spouse|children|family status)\b`,
    // religion, caste, race, national or ethnic origin, language as a proxy for origin
    String.raw`\b(religio\w*|hindu|muslim|christian|sikh|jain|buddhist|jewish|caste|racial|ethnic\w*|nationality|national origin|native (\w+ )?speaker|mother tongue|accent)\b`,
    // disability, health, appearance
    String.raw`\b(disabilit\w*|disabled|handicap\w*|able[- ]bodied|medical history|photograph|recent photo|passport[- ]size photo|good[- ]looking|complexion)\b`,
    String.raw`\b(sexual orientation|transgender)\b`,
  ].join("|"),
  "i",
);
const PROXY = /\b(career gaps?|employment gaps?|gaps? in (employment|career)|no gaps|continuous employment|resume format\w*|cv format\w*|writing polish|well[- ]written|top[- ]tier (university|school|college|institute)|tier[- ]?1 (university|college|institute)|IIT|IIM|ivy league|prestigious|elite (university|school|college)|recent graduate|fresh graduate|digital native|culture fit|cultural fit|linear career|energetic team)\b/i;

/** Returns a reason to refuse a criterion, or null when it can be used. */
export function criterionFairnessIssue(name: string, description: string): string | null {
  const text = `${name} ${description}`;
  if (PROTECTED.test(text))
    return "This appears to refer to a protected characteristic (such as age, gender, religion, nationality, disability or family status) or a proxy for one. Talyn won't score it. Rephrase it as a job-related requirement, e.g. a specific language proficiency or legal work authorization.";
  if (PROXY.test(text) && !/job-related reason:\s*\S{10,}/i.test(description))
    return "Career gaps, CV formatting, writing polish, school prestige or a particular career path aren't scored unless there's a specific job-related reason. Add “Job-related reason: …” to the description to document and approve it.";
  return null;
}
