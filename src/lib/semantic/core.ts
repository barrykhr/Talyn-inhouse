// Search by meaning: the pure parts. What text represents a person (work-related only: never the
// name or contact details), cosine similarity, plain-language match bands, and the closest line
// for evidence. No database, no network.

export const EMBED_DIMS = 256;
export const MAX_EMBED_CHARS = 8000;

/** Unit-length copy (cosine similarity then equals the dot product). */
export function normalize(v: number[]): number[] {
  const n = Math.sqrt(v.reduce((s, x) => s + x * x, 0));
  return n ? v.map((x) => x / n) : v.map(() => 0);
}

export function cosine(a: number[], b: number[]): number {
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return na && nb ? dot / Math.sqrt(na * nb) : 0;
}

/** Change detector for embedded text (two 32-bit FNV-1a passes). Not for security. */
export function hashText(t: string): string {
  let a = 0x811c9dc5, b = 0x01000193 ^ t.length;
  for (let i = 0; i < t.length; i++) {
    const c = t.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193);
    b = Math.imul(b ^ c, 0x5bd1e995);
  }
  return `${(a >>> 0).toString(16).padStart(8, "0")}${(b >>> 0).toString(16).padStart(8, "0")}${t.length.toString(16)}`;
}

const EMAIL = /[\w.+-]+@[\w-]+\.[\w.-]+/g;
const PHONE = /\+?\d[\d\s().-]{8,}\d/g;
const URL = /https?:\/\/\S+/g;
export const stripContact = (t: string) => t.replace(EMAIL, " ").replace(URL, " ").replace(PHONE, " ");

const clean = (t: string) => stripContact(t).replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();

/** A candidate as text: current role, location, confirmed skills and history, their own summary, then the CV. */
export function candidateText(c: { currentTitle: string | null; currentCompany: string | null; location: string | null; candidateSummary: string | null }, extras: string[], cvPages: string[]): string {
  const head = [[c.currentTitle, c.currentCompany].filter(Boolean).join(" at "), c.location ?? "", ...extras, c.candidateSummary ?? ""].filter((x) => x && x.trim());
  return clean([...head, cvPages.join("\n")].join("\n")).slice(0, MAX_EMBED_CHARS);
}

/** A Discover result as text: title, company, location and what the source returned. */
export function sourcedText(p: { currentTitle: string | null; currentCompany: string | null; location: string | null; profileText: string | null; signalsJson: string }): string {
  let quotes: string[] = [];
  try {
    quotes = (JSON.parse(p.signalsJson) as { quote?: string | null }[]).map((s) => s.quote ?? "").filter(Boolean);
  } catch {
    quotes = [];
  }
  const body = p.profileText?.trim() ? p.profileText : quotes.join("\n");
  return clean([[p.currentTitle, p.currentCompany].filter(Boolean).join(" at "), p.location ?? "", body].filter(Boolean).join("\n")).slice(0, MAX_EMBED_CHARS);
}

/** Lines worth quoting as evidence: 25–300 characters, deduplicated, at most `max`. */
export function evidenceLines(text: string, max = 25): string[] {
  const seen = new Set<string>();
  return text
    .split(/\n+|(?<=[.!?;])\s+(?=[A-Z0-9])/)
    .map((l) => l.replace(/^[\s•\-*·]+/, "").trim())
    .filter((l) => l.length >= 25 && l.length <= 300 && !seen.has(l.toLowerCase()) && (seen.add(l.toLowerCase()), true))
    .slice(0, max);
}

export type MeaningBand = "strong" | "good" | "some" | "weak";
export const MEANING_LABEL: Record<MeaningBand, string> = { strong: "Strong match", good: "Good match", some: "Some match", weak: "Weak match" };

/**
 * Plain-language band for a cosine similarity from text-embedding-3-small at 256 dimensions.
 * Calibrated on live searches (Nov 2026): unrelated searches scored 0.32–0.42, relevant ones
 * 0.50–0.62, near-identical profiles 0.75+. Bands are for reading, not decisions.
 */
export function meaningBand(sim: number): MeaningBand {
  return sim >= 0.58 ? "strong" : sim >= 0.5 ? "good" : sim >= 0.45 ? "some" : "weak";
}

/** Relevance points (0–10) for closeness in meaning to the role. Ordering only. */
export function meaningPoints(sim: number | null | undefined): number {
  if (sim === null || sim === undefined || !Number.isFinite(sim)) return 0;
  // Nothing below what unrelated text scores (about 0.42); full points from 0.60.
  return Math.round(Math.max(0, Math.min(1, (sim - 0.42) / 0.18)) * 10);
}

/**
 * A deterministic stand-in embedding (hashed bag of words) for tests and for local development
 * when TALYN_FAKE_EMBEDDINGS=1. It matches shared words, not meaning, and is labelled as such.
 */
export function fakeEmbed(text: string, dims = EMBED_DIMS): number[] {
  const v = new Array<number>(dims).fill(0);
  for (const w of text.toLowerCase().match(/[\p{L}\p{N}+#]{2,}/gu) ?? []) {
    let h = 2166136261;
    for (let i = 0; i < w.length; i++) h = Math.imul(h ^ w.charCodeAt(i), 16777619);
    v[(h >>> 0) % dims] += 1;
  }
  return normalize(v);
}
