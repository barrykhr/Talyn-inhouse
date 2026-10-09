// Interview rubric and scorecard shapes. Pure — safe on client and server.

/** One consistent 4-point scale for every competency, plus "Not assessed" (never a zero). */
export const RATING_LEVELS = [1, 2, 3, 4] as const;
export type Rating = (typeof RATING_LEVELS)[number];
export const RATING_LABEL: Record<Rating, string> = {
  1: "Not demonstrated",
  2: "Partly demonstrated",
  3: "Demonstrated",
  4: "Strongly demonstrated",
};

export type Anchors = Record<"1" | "2" | "3" | "4", string>;

/** Default behavioral anchors, written against the criterion itself (used when AI is off). */
export function defaultAnchors(criterion: string): Anchors {
  const c = criterion.trim().replace(/\.$/, "");
  return {
    "1": `Answers didn't show evidence of “${c}”, or stayed general or hypothetical.`,
    "2": `Some relevant examples of “${c}”, but limited in scope, depth or personal contribution.`,
    "3": `Clear, specific examples showing “${c}” at the level this role requires, with their own actions and outcomes.`,
    "4": `Several specific examples of “${c}” beyond what the role requires, with clear ownership and results.`,
  };
}

export function parseAnchors(json: string, criterion: string): Anchors {
  try {
    const a = JSON.parse(json) as Partial<Anchors>;
    const d = defaultAnchors(criterion);
    return { "1": a["1"] || d["1"], "2": a["2"] || d["2"], "3": a["3"] || d["3"], "4": a["4"] || d["4"] };
  } catch {
    return defaultAnchors(criterion);
  }
}

export type ScoreEntry = { competencyId: string; rating: Rating | null; notAssessed: boolean; evidence: string };

export function parseEntries(json: string): ScoreEntry[] {
  try {
    const v = JSON.parse(json) as ScoreEntry[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

/**
 * How interviewers' ratings for one competency relate. Describes spread only — never averaged
 * into a verdict. "Disagree" = ratings two or more levels apart.
 */
export function agreement(ratings: number[]): { kind: "none" | "single" | "aligned" | "mixed" | "disagree"; label: string } {
  if (!ratings.length) return { kind: "none", label: "No ratings" };
  if (ratings.length === 1) return { kind: "single", label: "One rating" };
  const spread = Math.max(...ratings) - Math.min(...ratings);
  if (spread === 0) return { kind: "aligned", label: "Same rating" };
  if (spread === 1) return { kind: "mixed", label: "Close (one level apart)" };
  return { kind: "disagree", label: `Disagree (${spread} levels apart)` };
}

export const DECISIONS = ["advance", "hold", "decline"] as const;
export const DECISION_LABEL: Record<(typeof DECISIONS)[number], string> = { advance: "Advance", hold: "Hold", decline: "Decline" };
