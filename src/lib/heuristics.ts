// Non-AI helpers used when no AI provider is configured (or by recruiter choice).
// Results are always labeled as keyword/extraction output in the UI, never as AI.

export type ExtractedCriterion = {
  name: string;
  importance: "essential" | "preferred";
  kind: "skill" | "criterion";
  sourceText: string;
};

const SKILLS_HEADING = /\b(skills|tech(nical)? stack|tools|technologies|languages)\b/i;

/** A short bullet naming a tool, technology or competency is a skill; longer requirements stay criteria. */
export function looksLikeSkill(text: string, underSkillsHeading: boolean) {
  const words = text.split(/\s+/).filter(Boolean).length;
  if (/\b(years?|degree|bachelor|master|phd|eligib|authori[sz]ed|located|relocat|travel|visa)\b/i.test(text)) return false;
  return underSkillsHeading ? words <= 8 : words <= 4;
}

const PREFERRED_HEADING = /(nice to have|preferred|bonus|plus|desirable|good to have|ideally)/i;
const REQUIRED_HEADING = /(requirement|qualification|must have|what you('|’)ll need|you have|you bring|skills|experience)/i;
const BULLET = /^\s*(?:[-*•·▪◦]|\d+[.)])\s+(.+)$/;

/** Turns bullet lines of a job description into draft criteria (pending recruiter approval). */
export function extractCriteriaFromJd(description: string): ExtractedCriterion[] {
  const out: ExtractedCriterion[] = [];
  let section: "essential" | "preferred" | "other" = "other";
  let skillsHeading = false;
  for (const raw of description.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const bullet = line.match(BULLET);
    if (!bullet) {
      if (line.length < 80) {
        skillsHeading = SKILLS_HEADING.test(line);
        if (PREFERRED_HEADING.test(line)) section = "preferred";
        else if (REQUIRED_HEADING.test(line)) section = "essential";
        else section = "other";
      }
      continue;
    }
    if (section === "other") continue;
    const text = bullet[1].trim().replace(/[.;]$/, "");
    if (text.length < 4) continue;
    const inlinePreferred = PREFERRED_HEADING.test(text);
    out.push({
      name: text.length > 90 ? text.slice(0, 87).trimEnd() + "…" : text,
      importance: section === "preferred" || inlinePreferred ? "preferred" : "essential",
      kind: looksLikeSkill(text, skillsHeading) ? "skill" : "criterion",
      sourceText: line,
    });
    if (out.length >= 15) break;
  }
  return out;
}

const STOP = new Set(
  "a an and or the of in on for to with without at by from as is are be have has years year experience strong excellent good ability able skills skill knowledge understanding working work proven demonstrated plus including such using use etc least minimum preferred required must nice similar related relevant field degree".split(
    " ",
  ),
);

export function keywordsFor(name: string, description: string): string[] {
  const words = `${name} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9+#./\s-]/g, " ")
    .split(/\s+/)
    .map((w) => w.replace(/^[./-]+|[./-]+$/g, ""))
    .filter((w) => w.length >= 2 && !STOP.has(w) && !/^\d+\+?$/.test(w));
  return Array.from(new Set(words)).slice(0, 12);
}

/** Splits text into sentence/bullet-sized snippets for keyword matching. */
export function snippets(text: string): string[] {
  return text
    .split(/\n|(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length >= 6);
}

export function keywordMatch(keywords: string[], text: string) {
  const hits: { snippet: string; matched: string[] }[] = [];
  for (const s of snippets(text)) {
    const lower = s.toLowerCase();
    const matched = keywords.filter((k) => new RegExp(`(^|[^a-z0-9])${escapeRe(k)}($|[^a-z0-9])`).test(lower));
    if (matched.length) hits.push({ snippet: s.length > 240 ? s.slice(0, 240) : s, matched });
  }
  hits.sort((a, b) => b.matched.length - a.matched.length);
  return hits.slice(0, 2);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The skill's name plus recruiter-entered aliases, as lowercase search phrases. */
export function skillTerms(name: string, aliases: string): string[] {
  return Array.from(
    new Set(
      [name, ...aliases.split(",")]
        .map((t) => t.trim().toLowerCase().replace(/\s+/g, " "))
        .filter((t) => t.length >= 1 && t.length <= 80),
    ),
  );
}

/** Lines that mention one of the skill's terms as a whole word or phrase. */
export function findSkillMentions(terms: string[], text: string) {
  const hits: { snippet: string; term: string }[] = [];
  for (const s of snippets(text)) {
    const lower = s.toLowerCase().replace(/\s+/g, " ");
    const term = terms.find((t) => new RegExp(`(^|[^a-z0-9+#])${escapeRe(t)}($|[^a-z0-9+#])`).test(lower));
    if (term) hits.push({ snippet: s.length > 240 ? s.slice(0, 240) : s, term });
    if (hits.length >= 2) break;
  }
  return hits;
}
