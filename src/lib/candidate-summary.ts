// Short summaries for the candidate page: the single best quote per criterion, the factors that
// moved the score most, and up to three relevance bullets. Pure and presentation-only: nothing
// here changes or drops stored data; the full detail stays one click away on the page.
import type { ProfileRow } from "./profile-score";
import { skillStatus } from "./skills";

export const QUOTE_MAX = 160;

/** Cuts at a word boundary near max and adds "…"; short text is returned unchanged. */
export function truncate(text: string, max = QUOTE_MAX): string {
  const t = text.replace(/\s+/g, " ").trim();
  if (t.length <= max) return t;
  const cut = t.slice(0, max - 1);
  const space = cut.lastIndexOf(" ");
  return `${(space > max * 0.6 ? cut.slice(0, space) : cut).replace(/[\s,.;:–-]+$/, "")}…`;
}

/** The quote to show first: verified before unverified, then the most specific (longest up to the limit). */
export function bestQuote<E extends { quote: string; verified: boolean }>(evidence: E[]): E | null {
  const usable = evidence.filter((e) => e.quote?.trim());
  if (!usable.length) return null;
  const score = (e: E) => (e.verified ? 1000 : 0) + Math.min(e.quote.trim().length, QUOTE_MAX);
  return [...usable].sort((a, b) => score(b) - score(a))[0];
}

export type ScoreFactor = { name: string; points: number; direction: "up" | "down"; why: string };

/**
 * The items that moved the score most, in score points out of 100: earned points for items with
 * evidence, and points not earned for weighted items without full credit. Informational items and
 * items without a credit don't move the score and are left out.
 */
export function topScoreFactors(rows: ProfileRow[], n = 3): ScoreFactor[] {
  const scored = rows.filter((r) => r.weight > 0 && r.credit !== null);
  const total = scored.reduce((s, r) => s + r.weight, 0);
  if (!total) return [];
  const factors: ScoreFactor[] = [];
  for (const r of scored) {
    const earned = (r.weight * (r.credit ?? 0) * 100) / total;
    const missed = (r.weight * (1 - (r.credit ?? 0)) * 100) / total;
    if (earned >= missed && earned > 0) factors.push({ name: r.name, points: Math.round(earned), direction: "up", why: r.credit === 1 ? "evidence found" : "partial evidence" });
    else if (missed > 0) factors.push({ name: r.name, points: Math.round(missed), direction: "down", why: r.result === "confirmed_absent" ? "confirmed not present" : r.credit ? "partial evidence" : "no evidence in the material" });
  }
  return factors.sort((a, b) => b.points - a.points || a.name.localeCompare(b.name)).slice(0, n);
}

type SkillItem = { criterionName: string; importance: string; result: string; overrideResult: string | null };

/** At most three short bullets: strongest matches, biggest gap, and what needs a person. */
export function relevanceBullets(skillItems: SkillItem[]): string[] {
  const required = skillItems.filter((i) => i.importance !== "preferred");
  const status = (i: SkillItem) => skillStatus(i.overrideResult ?? i.result);
  const list = (names: string[], max = 3) => (names.length > max ? `${names.slice(0, max).join(", ")} +${names.length - max}` : names.join(", "));
  const found = required.filter((i) => status(i) === "evidence_found").map((i) => i.criterionName);
  const missing = required.filter((i) => status(i) === "no_evidence" || status(i) === "confirmed_absent").map((i) => i.criterionName);
  const review = required.filter((i) => status(i) === "needs_review" || status(i) === "partial").map((i) => i.criterionName);
  const out: string[] = [];
  if (found.length) out.push(`Strongest: ${list(found)}`);
  if (missing.length) out.push(`Biggest gap: ${list(missing)} — no evidence in the material`);
  if (review.length) out.push(`To check: ${list(review)}`);
  return out.slice(0, 3);
}
