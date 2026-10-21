// Deterministic profile checks that point at specific, quoted statements. They never judge a
// person; they show where two statements disagree so a recruiter can ask.

export type TextSource = { source: string; text: string };
export type ExperienceClaim = { years: number; quote: string; source: string };

// "6 years of experience", "8+ years of professional experience", "Total experience: 2 years",
// "total experience is 6 years", "experience: 4 yrs". Requirement-style phrases such as
// "5+ years building backend services" don't match: the number must be tied to experience overall.
const PATTERNS = [
  /\b(\d{1,2})\+?\s*(?:years?|yrs?)\s+(?:of\s+)?(?:total\s+|overall\s+|professional\s+|work\s+|industry\s+|relevant\s+)?experience\b/gi,
  /\b(?:total|overall)\s+(?:work\s+|professional\s+)?experience\s*(?:is|of|:|-|—)?\s*(?:about\s+|around\s+|nearly\s+)?(\d{1,2})\+?\s*(?:years?|yrs?)\b/gi,
];

/** Statements of overall years of experience, with the sentence they came from. */
export function experienceClaims(sources: TextSource[]): ExperienceClaim[] {
  const out: ExperienceClaim[] = [];
  for (const s of sources) {
    const seen = new Set<number>();
    for (const re of PATTERNS) {
      for (const m of s.text.matchAll(re)) {
        const years = Number(m[1]);
        if (!Number.isFinite(years) || years > 60 || seen.has(years)) continue;
        seen.add(years);
        const start = Math.max(0, s.text.lastIndexOf("\n", m.index!) + 1);
        const endNl = s.text.indexOf("\n", m.index! + m[0].length);
        const line = s.text.slice(start, endNl === -1 ? undefined : endNl).trim();
        out.push({ years, quote: line.length > 160 ? `…${m[0]}…` : line, source: s.source });
      }
    }
  }
  return out;
}

/** A disagreement of two or more years between experience statements, or null. */
export function experienceMismatch(sources: TextSource[]): { low: ExperienceClaim; high: ExperienceClaim } | null {
  const claims = experienceClaims(sources);
  if (claims.length < 2) return null;
  const low = claims.reduce((a, b) => (b.years < a.years ? b : a));
  const high = claims.reduce((a, b) => (b.years > a.years ? b : a));
  return high.years - low.years >= 2 ? { low, high } : null;
}
