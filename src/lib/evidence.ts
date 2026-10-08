// Locates quoted evidence in source text so every claim can be checked by a recruiter.
// Pure functions — no server-only dependencies.
import type { Evidence, EvidenceSource } from "./domain";

export type SourceDoc = {
  resumePages: string[];
  profileText: string;
};

const HEADING_WORDS =
  /^(summary|profile|about|objective|experience|work experience|professional experience|employment|employment history|education|skills|technical skills|core skills|certifications?|licen[cs]es|projects|publications|awards|achievements|languages|volunteer(ing)?|interests|training|leadership|references|requirements|qualifications|responsibilities|key responsibilities|nice to have|preferred qualifications|minimum qualifications|about the role|about you|about us|the role|what you('|’)ll do|what you('|’)ll bring|what we('|’)re looking for|you have|benefits|perks)\b/i;

function squash(s: string) {
  return s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, "-").replace(/\s+/g, " ").trim();
}

/** Finds the nearest heading-like line above `index` in `text`. */
export function sectionAt(text: string, index: number): string | null {
  const before = text.slice(0, index).split("\n").reverse();
  for (const raw of before) {
    const line = raw.trim().replace(/[:\-–—]+$/, "").trim();
    if (!line || line.length > 40) continue;
    if (HEADING_WORDS.test(line)) return titleCase(line);
    const letters = line.replace(/[^A-Za-z]/g, "");
    if (letters.length >= 4 && letters === letters.toUpperCase() && line.split(/\s+/).length <= 4) return titleCase(line);
  }
  return null;
}

function titleCase(s: string) {
  return s.toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Index of `needle` in `hay` ignoring case/whitespace differences, mapped back to `hay`. */
function fuzzyIndex(hay: string, needle: string): number {
  const n = squash(needle);
  if (n.length < 3) return -1;
  // Build squashed haystack with an index map back to the original.
  let out = "";
  const map: number[] = [];
  let prevSpace = true;
  for (let i = 0; i < hay.length; i++) {
    const c = squash(hay[i]) || (/\s/.test(hay[i]) ? " " : "");
    if (c === " " || c === "") {
      if (!prevSpace && /\s/.test(hay[i])) {
        out += " ";
        map.push(i);
        prevSpace = true;
      }
      continue;
    }
    out += c;
    map.push(i);
    prevSpace = false;
  }
  const at = out.indexOf(n);
  return at === -1 ? -1 : map[at];
}

/** Resolves page/section and verifies that a quote actually exists in the given source. */
export function locateQuote(doc: SourceDoc, quote: string, preferred: EvidenceSource): Evidence {
  const q = quote.trim();
  const tryResume = (): Evidence | null => {
    for (let p = 0; p < doc.resumePages.length; p++) {
      const idx = fuzzyIndex(doc.resumePages[p], q);
      if (idx >= 0) {
        return {
          quote: q,
          source: "resume",
          page: doc.resumePages.length > 1 ? p + 1 : null,
          section: sectionAt(doc.resumePages[p], idx),
          verified: true,
        };
      }
    }
    return null;
  };
  const tryProfile = (): Evidence | null =>
    fuzzyIndex(doc.profileText, q) >= 0 ? { quote: q, source: "profile", page: null, section: "Candidate-provided information", verified: true } : null;

  const found = preferred === "profile" ? tryProfile() ?? tryResume() : tryResume() ?? tryProfile();
  return found ?? { quote: q, source: preferred, page: null, section: null, verified: false };
}

export function parseEvidence(json: string): Evidence[] {
  try {
    const v = JSON.parse(json);
    return Array.isArray(v) ? (v as Evidence[]) : [];
  } catch {
    return [];
  }
}
