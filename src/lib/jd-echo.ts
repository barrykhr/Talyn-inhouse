// Evidence that only repeats the requirement. A CV line that restates a criterion word for word
// ("3+ years of SQL for analysis") or copies a long run of the job description says the candidate
// wrote the words, not that they did the work. Such evidence is not counted as "supported": the
// item goes to a recruiter for review instead. Nothing is rejected or hidden. Pure functions.
import type { Evidence } from "./domain";

/** A criterion name needs at least this many words before a verbatim repeat counts as an echo. */
export const ECHO_MIN_CRITERION_WORDS = 3;
/** Consecutive words shared with the job description that count as copied text. */
export const ECHO_MIN_JD_RUN = 8;

const words = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}+#]+/gu, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);

/** Length of the longest run of consecutive words that appears in both texts (case and punctuation ignored). */
export function longestSharedRun(a: string, b: string): number {
  const x = words(a);
  const y = words(b);
  if (!x.length || !y.length) return 0;
  let best = 0;
  let prev = new Array<number>(y.length + 1).fill(0);
  for (let i = 1; i <= x.length; i++) {
    const cur = new Array<number>(y.length + 1).fill(0);
    for (let j = 1; j <= y.length; j++) {
      if (x[i - 1] === y[j - 1]) {
        cur[j] = prev[j - 1] + 1;
        if (cur[j] > best) best = cur[j];
      }
    }
    prev = cur;
  }
  return best;
}

/**
 * Why a quote reads as a repeat of the requirement rather than evidence, or null when it doesn't:
 * "criterion" when it contains the whole criterion name (3+ words) word for word, "jd" when it
 * shares 8+ consecutive words with the job description.
 */
export function echoesRequirement(quote: string, criterionName: string, jdText?: string | null): "criterion" | "jd" | null {
  const q = ` ${words(quote).join(" ")} `;
  const c = words(criterionName);
  if (c.length >= ECHO_MIN_CRITERION_WORDS && q.includes(` ${c.join(" ")} `)) return "criterion";
  if (jdText && longestSharedRun(quote, jdText) >= ECHO_MIN_JD_RUN) return "jd";
  return null;
}

type Draft = { criterionName: string; kind: string; result: string; evidence: Evidence[]; explanation: string; missingInfo: string; confidence: string | null };

export const ECHO_NOTE =
  "[Talyn: every quote for this item repeats the requirement's wording instead of describing work the candidate did, so it is counted as needing review, not as supported. Ask for a specific example.]";

/**
 * Downgrades evaluation criteria (not single skills, which CVs legitimately list) whose verified
 * evidence is all echo to "inferred" (needs review). Returns the drafts and the names affected.
 */
export function applyEchoGuard<D extends Draft>(drafts: D[], jdText?: string | null): { drafts: D[]; echoed: string[] } {
  const echoed: string[] = [];
  const out = drafts.map((d) => {
    if (d.kind === "skill" || (d.result !== "supported" && d.result !== "partially_supported")) return d;
    const verified = d.evidence.filter((e) => e.verified && e.quote.trim());
    if (!verified.length || !verified.every((e) => echoesRequirement(e.quote, d.criterionName, jdText))) return d;
    echoed.push(d.criterionName);
    return {
      ...d,
      result: "inferred",
      confidence: "low",
      explanation: `${d.explanation} ${ECHO_NOTE}`.trim(),
      missingInfo: d.missingInfo?.trim() || "A specific example of this work: what they did, where, and the result.",
    };
  });
  return { drafts: out, echoed };
}

/** The line shown on the candidate page when evidence repeats the job description. */
export function echoSummary(echoed: string[]): string | null {
  if (!echoed.length) return null;
  const list = echoed.length > 3 ? `${echoed.slice(0, 3).join(", ")} +${echoed.length - 3}` : echoed.join(", ");
  return `The CV repeats the job description's wording for ${echoed.length} criteri${echoed.length === 1 ? "on" : "a"} (${list}). Talyn counted ${echoed.length === 1 ? "it" : "them"} as needing review, not as supported.`;
}
