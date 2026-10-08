import "server-only";
import { AiRequestError, AiUnavailableError, aiStatus, extractCvWithAi, extractJdWithAi } from "./ai";
import { locateQuote } from "./evidence";
import { extractCriteriaFromJd } from "./heuristics";
import { logError } from "./log";

// Turns a parsed JD or CV into reviewable facts. Every fact keeps the text it came from,
// located (page/section) and verified against the document. Nothing here writes to the
// role or candidate record: facts stay "pending" until a recruiter reviews them.

export const JD_EXTRACT_VERSION = "jd-extract-v1";
export const CV_EXTRACT_VERSION = "cv-extract-v1";
export const JD_PARSER_VERSION = "parser:jd-heuristic-v1";
export const CV_PARSER_VERSION = "parser:cv-heuristic-v1";
export const CONTACT_PARSER_VERSION = "parser:contact-regex-v1";

export type FactDraft = {
  field: string;
  value: unknown;
  sourceQuote: string | null;
  sourcePage: number | null;
  sourceSection: string | null;
  verified: boolean;
  extractor: string;
};

export type CriterionDraft = {
  name: string;
  description: string;
  importance: "essential" | "preferred";
  sourceText: string | null;
  sourcePage: number | null;
  sourceSection: string | null;
  rationale: string | null;
};

export type ExtractionOutcome<T> = T & { method: "ai" | "parser"; extractor: string; notice: string | null };

function locate(pages: string[], quote: string | null | undefined) {
  if (!quote?.trim()) return { sourceQuote: null, sourcePage: null, sourceSection: null, verified: false };
  const e = locateQuote({ resumePages: pages, profileText: "" }, quote, "resume");
  return { sourceQuote: e.quote, sourcePage: e.verified ? (e.page ?? (pages.length === 1 ? 1 : null)) : null, sourceSection: e.section ?? null, verified: e.verified };
}

const fact = (pages: string[], extractor: string, field: string, value: unknown, quote: string | null | undefined): FactDraft => ({
  field,
  value,
  extractor,
  ...locate(pages, quote),
});

/** Why AI wasn't used, phrased for the recruiter. */
function fallbackNotice(err: unknown) {
  if (err instanceof AiUnavailableError) return "AI is not configured, so a basic (non-AI) parser was used. Expect fewer extracted details.";
  if (err instanceof AiRequestError) return `AI extraction failed (${err.message}) A basic (non-AI) parser was used instead.`;
  return "AI extraction failed, so a basic (non-AI) parser was used instead.";
}

// ---------------------------------------------------------------- JD

export async function extractJobDescription(pages: string[]): Promise<ExtractionOutcome<{ facts: FactDraft[]; criteria: CriterionDraft[] }>> {
  const text = pages.join("\n\n");
  const ai = aiStatus();
  if (ai.configured) {
    try {
      const r = await extractJdWithAi(text);
      const ex = `ai:${ai.provider}:${ai.model}/${JD_EXTRACT_VERSION}`;
      const facts: FactDraft[] = [];
      if (r.title) facts.push(fact(pages, ex, "title", r.title.value, r.title.source_quote));
      if (r.department) facts.push(fact(pages, ex, "department", r.department.value, r.department.source_quote));
      if (r.location) facts.push(fact(pages, ex, "location", r.location.value, r.location.source_quote));
      if (r.employment_type) facts.push(fact(pages, ex, "employment_type", r.employment_type.value, r.employment_type.source_quote));
      for (const x of r.responsibilities) facts.push(fact(pages, ex, "responsibility", x.value, x.source_quote));
      for (const x of r.qualifications) facts.push(fact(pages, ex, "qualification", x.value, x.source_quote));
      for (const x of r.experience_requirements) facts.push(fact(pages, ex, "experience_requirement", x.value, x.source_quote));
      const criteria: CriterionDraft[] = r.criteria.map((c) => {
        const loc = locate(pages, c.source_quote);
        return {
          name: c.name.slice(0, 200),
          description: c.description.slice(0, 2000),
          importance: c.importance,
          sourceText: loc.verified ? loc.sourceQuote : null, // keep citations only if they exist in the JD
          sourcePage: loc.sourcePage,
          sourceSection: loc.sourceSection,
          rationale: c.rationale || null,
        };
      });
      return { facts, criteria, method: "ai", extractor: ex, notice: null };
    } catch (err) {
      if (!(err instanceof AiRequestError)) logError("extract.jd_ai_failed", err);
      return { ...heuristicJd(pages), notice: fallbackNotice(err) };
    }
  }
  return { ...heuristicJd(pages), notice: fallbackNotice(new AiUnavailableError()) };
}

const LABELLED = (label: string) => new RegExp(`^\\s*(?:${label})\\s*[:\\-–]\\s*(.{2,120})$`, "im");

function heuristicJd(pages: string[]) {
  const text = pages.join("\n\n");
  const ex = JD_PARSER_VERSION;
  const facts: FactDraft[] = [];
  const labelled = (field: string, label: string) => {
    const m = text.match(LABELLED(label));
    if (m) facts.push(fact(pages, ex, field, m[1].trim(), m[0].trim()));
    return m;
  };
  if (!labelled("title", "job title|position|role title|role")) {
    const first = text.split("\n").map((l) => l.trim()).find((l) => l.length >= 3 && l.length <= 80 && !/[.:]$/.test(l));
    if (first) facts.push(fact(pages, ex, "title", first, first));
  }
  labelled("department", "department|team|function");
  labelled("location", "location|based in|office");
  const type = text.match(/\b(full[- ]time|part[- ]time|contract(?:or)?|temporary|internship)\b/i);
  if (type) {
    const v = type[1].toLowerCase().replace(/[- ]/, "_").replace("contractor", "contract");
    facts.push(fact(pages, ex, "employment_type", v, type[0]));
  }
  const criteria: CriterionDraft[] = extractCriteriaFromJd(text).map((c) => {
    const loc = locate(pages, c.sourceText);
    return {
      name: c.name,
      description: "",
      importance: c.importance,
      sourceText: c.sourceText,
      sourcePage: loc.sourcePage,
      sourceSection: loc.sourceSection,
      rationale: "Bullet point from a requirements section of the job description.",
    };
  });
  for (const c of criteria) facts.push(fact(pages, ex, "qualification", c.name, c.sourceText));
  return { facts, criteria, method: "parser" as const, extractor: ex };
}

// ---------------------------------------------------------------- CV

const EMAIL = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
const PHONE = /(?<![\w])(\+?\d[\d\s().-]{7,}\d)(?![\w])/;
const LINKEDIN = /(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[\w\-%]+\/?/i;

/** Contact details are extracted locally with patterns and never sent to an AI provider. */
function contactFacts(pages: string[]): FactDraft[] {
  const text = pages.join("\n\n");
  const out: FactDraft[] = [];
  const email = text.match(EMAIL);
  if (email) out.push(fact(pages, CONTACT_PARSER_VERSION, "email", email[0].toLowerCase(), email[0]));
  const phone = text.match(PHONE);
  if (phone && phone[1].replace(/\D/g, "").length >= 9) out.push(fact(pages, CONTACT_PARSER_VERSION, "phone", phone[1].trim(), phone[1]));
  const li = text.match(LINKEDIN);
  if (li) out.push(fact(pages, CONTACT_PARSER_VERSION, "linkedin_url", li[0].startsWith("http") ? li[0] : `https://${li[0]}`, li[0]));
  return out;
}

export function redactContact(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(?<![\w])(\+?\d[\d\s().-]{7,}\d)(?![\w])/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m));
}

export async function extractCv(pages: string[]): Promise<ExtractionOutcome<{ facts: FactDraft[] }>> {
  const contacts = contactFacts(pages);
  const ai = aiStatus();
  if (ai.configured) {
    try {
      const r = await extractCvWithAi(redactContact(pages.join("\n\n")));
      const ex = `ai:${ai.provider}:${ai.model}/${CV_EXTRACT_VERSION}`;
      const facts: FactDraft[] = [...contacts];
      if (r.full_name) facts.push(fact(pages, ex, "full_name", r.full_name.value, r.full_name.source_quote));
      if (r.location) facts.push(fact(pages, ex, "location", r.location.value, r.location.source_quote));
      if (r.current_title) facts.push(fact(pages, ex, "current_title", r.current_title.value, r.current_title.source_quote));
      if (r.current_company) facts.push(fact(pages, ex, "current_company", r.current_company.value, r.current_company.source_quote));
      for (const w of r.work_history) facts.push(fact(pages, ex, "work_history", { title: w.title, employer: w.employer, start: w.start, end: w.end }, w.source_quote));
      for (const e of r.education) facts.push(fact(pages, ex, "education", { institution: e.institution, credential: e.credential, field: e.field }, e.source_quote));
      for (const s of r.skills) facts.push(fact(pages, ex, "skill", s.value, s.source_quote));
      for (const c of r.certifications) facts.push(fact(pages, ex, "certification", { name: c.name, issuer: c.issuer }, c.source_quote));
      return { facts, method: "ai", extractor: ex, notice: null };
    } catch (err) {
      if (!(err instanceof AiRequestError)) logError("extract.cv_ai_failed", err);
      return { facts: [...contacts, ...heuristicCv(pages)], method: "parser", extractor: CV_PARSER_VERSION, notice: fallbackNotice(err) };
    }
  }
  return { facts: [...contacts, ...heuristicCv(pages)], method: "parser", extractor: CV_PARSER_VERSION, notice: fallbackNotice(new AiUnavailableError()) };
}

function heuristicCv(pages: string[]): FactDraft[] {
  const text = pages.join("\n\n");
  const ex = CV_PARSER_VERSION;
  const out: FactDraft[] = [];
  // Name: first line that looks like 2–4 capitalised words.
  const nameLine = text
    .split("\n")
    .map((l) => l.trim())
    .slice(0, 8)
    .find((l) => /^[A-Z][\p{L}'’.-]+(?:\s+[A-Z][\p{L}'’.-]+){1,3}$/u.test(l));
  if (nameLine) out.push(fact(pages, ex, "full_name", nameLine, nameLine));
  // Skills: comma/bullet separated items under a "Skills" heading.
  const m = text.match(/^\s*(?:technical\s+|core\s+|key\s+)?skills\s*:?\s*\n([\s\S]{0,1200}?)(?:\n\s*\n[A-Z][A-Za-z ]{2,40}\n|$)/im);
  if (m) {
    const items = m[1]
      .split(/[,;\n•·|]/)
      .map((s) => s.replace(/^[-*\s]+/, "").trim())
      .filter((s) => s.length >= 2 && s.length <= 40)
      .slice(0, 30);
    for (const s of Array.from(new Set(items))) out.push(fact(pages, ex, "skill", s, s));
  }
  return out;
}
