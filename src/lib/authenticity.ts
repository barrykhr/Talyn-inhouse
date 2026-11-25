// Answer checks: whether what a candidate told the recruiter hangs together with their CV and public
// work. Six rule-based checks, each pointing at specific quoted text. They flag things for a person
// to ask about; they never judge, score or reject anyone, and none of them can prove an answer was
// written by AI. Pure functions (no database, no AI).
import { longestSharedRun } from "./jd-echo";
import { experienceMismatch, type TextSource } from "./profile-checks";

export type CheckStatus = "passed" | "flag" | "not_enough";
export type AnswerCheck = { key: string; label: string; status: CheckStatus; detail: string; quotes: string[] };
export type Answer = { label: string; channel: string; text: string };

export const CHECK_STATUS_LABEL: Record<CheckStatus, string> = { passed: "No issues", flag: "Check with a person", not_enough: "Not enough to check" };

/** Splits candidate-provided information into the answer blocks Talyn records ("Candidate's answers (WhatsApp, …):"). */
export function extractAnswers(summary: string | null | undefined): Answer[] {
  const text = summary ?? "";
  const re = /Candidate's answers \(([^)]*)\):\n/g;
  const marks = [...text.matchAll(re)];
  return marks.map((m, i) => {
    const start = m.index! + m[0].length;
    const end = i + 1 < marks.length ? marks[i + 1].index! : text.length;
    const label = m[1];
    const channel = (label.split(",")[0] ?? "conversation").trim().toLowerCase();
    return { label, channel, text: text.slice(start, end).trim() };
  });
}

const SPECIFIC = [
  /\d/, // numbers, years, percentages, team sizes
  /\b[A-Z][a-zA-Z0-9+#.]*[A-Z0-9+#][a-zA-Z0-9+#.]*\b/, // product-style names: PostgreSQL, AWS, gRPC, K8s
  /\b(built|led|owned|migrated|designed|reduced|cut|scaled|shipped|launched|fixed|wrote|ran)\b/i, // first-hand actions
];

/** 0–3: how many kinds of specifics an answer has (numbers, named systems, first-hand actions). */
export function specificity(text: string): number {
  return SPECIFIC.filter((re) => re.test(text)).length;
}

const GENERATED_PHRASES = [
  "as an ai",
  "i hope this message finds you well",
  "i hope this email finds you well",
  "delve",
  "in today's fast-paced",
  "it is important to note",
  "it's important to note",
  "in conclusion",
  "furthermore,",
  "moreover,",
  "tapestry",
  "leverage synergies",
  "i am confident that my skills",
  "passionate about leveraging",
];

/** Stock phrases common in machine-written text. Two or more is worth a person's look, nothing more. */
export function generatedPhrases(text: string): string[] {
  const t = text.toLowerCase();
  return GENERATED_PHRASES.filter((p) => t.includes(p));
}

const mentions = (text: string, term: string) => new RegExp(`(^|[^\\p{L}\\p{N}])${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^\\p{L}\\p{N}])`, "iu").test(text);

const short = (s: string, n = 140) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * The six checks. `cv` is the CV text, `publicWork` the linked Discover record (GitHub and the like),
 * `prompts` the questions and JD the candidate was answering, `skills` the role's approved skills.
 */
export function answerChecks(input: { answers: Answer[]; cv: string; publicWork: string; prompts: string[]; skills: string[] }): AnswerCheck[] {
  const { answers, cv, publicWork, prompts, skills } = input;
  const all = answers.map((a) => a.text).join("\n");
  const none = (key: string, label: string, detail: string): AnswerCheck => ({ key, label, status: "not_enough", detail, quotes: [] });
  const out: AnswerCheck[] = [];

  // 1. Timeline: years of experience stated in the CV vs the answers.
  const sources: TextSource[] = [...(cv.trim() ? [{ source: "CV", text: cv }] : []), ...answers.map((a) => ({ source: `Answers (${a.label})`, text: a.text }))];
  const tl = experienceMismatch(sources);
  if (!cv.trim() || !answers.length) out.push(none("timeline", "Timeline consistency", "Needs both a CV and recorded answers."));
  else if (tl) out.push({ key: "timeline", label: "Timeline consistency", status: "flag", detail: `${tl.low.source} says ${tl.low.years} years of experience; ${tl.high.source} says ${tl.high.years}.`, quotes: [short(tl.low.quote), short(tl.high.quote)] });
  else out.push({ key: "timeline", label: "Timeline consistency", status: "passed", detail: "No disagreement about years of experience between the CV and the answers.", quotes: [] });

  // 2. Specificity: real answers name systems, numbers and what the person did.
  if (!answers.length) out.push(none("specificity", "Specificity", "No answers recorded yet."));
  else {
    const vague = answers.flatMap((a) => a.text.split(/\n+/)).filter((l) => l.trim().length >= 80 && specificity(l) < 2);
    out.push(
      vague.length
        ? { key: "specificity", label: "Specificity", status: "flag", detail: `${vague.length} answer${vague.length === 1 ? " is" : "s are"} general, with few numbers, named systems or first-hand actions. Ask for an example.`, quotes: vague.slice(0, 2).map((l) => short(l.trim())) }
        : { key: "specificity", label: "Specificity", status: "passed", detail: "Answers name systems, numbers or what the candidate did.", quotes: [] },
    );
  }

  // 3. Cross-channel: the same story across channels (e.g. WhatsApp vs email).
  const channels = new Set(answers.map((a) => a.channel));
  if (channels.size < 2) out.push(none("cross_channel", "Cross-channel consistency", "Needs answers from at least two channels."));
  else {
    const mm = experienceMismatch(answers.map((a) => ({ source: a.label, text: a.text })));
    out.push(
      mm
        ? { key: "cross_channel", label: "Cross-channel consistency", status: "flag", detail: `Answers disagree: ${mm.low.years} years (${mm.low.source}) vs ${mm.high.years} years (${mm.high.source}).`, quotes: [short(mm.low.quote), short(mm.high.quote)] }
        : { key: "cross_channel", label: "Cross-channel consistency", status: "passed", detail: "No disagreement found between channels.", quotes: [] },
    );
  }

  // 4. Public evidence: skills claimed in answers that public work also shows.
  const claimed = skills.filter((s) => mentions(all, s));
  if (!answers.length || !claimed.length) out.push(none("public_evidence", "Public evidence", !answers.length ? "No answers recorded yet." : "The answers don't name any of the role's skills."));
  else if (!publicWork.trim()) out.push(none("public_evidence", "Public evidence", "No linked public profile (for example from Discover) to compare with."));
  else {
    const missing = claimed.filter((s) => !mentions(publicWork, s));
    out.push(
      missing.length
        ? { key: "public_evidence", label: "Public evidence", status: "flag", detail: `Named in the answers but not seen in their public work: ${missing.join(", ")}. Public work rarely shows everything; ask for an example.`, quotes: [] }
        : { key: "public_evidence", label: "Public evidence", status: "passed", detail: `Public work also shows ${claimed.join(", ")}.`, quotes: [] },
    );
  }

  // 5. Generated-answer signals: stock phrases or text copied from the question or JD.
  if (!answers.length) out.push(none("generated", "Generated or copied text", "No answers recorded yet."));
  else {
    const phrases = generatedPhrases(all);
    const copied = answers.flatMap((a) => a.text.split(/\n+/)).filter((l) => prompts.some((p) => longestSharedRun(l, p) >= 8));
    const flags = [...(phrases.length >= 2 ? [`stock phrases (${phrases.map((p) => `“${p}”`).join(", ")})`] : []), ...(copied.length ? ["wording copied from the question or JD"] : [])];
    out.push(
      flags.length
        ? { key: "generated", label: "Generated or copied text", status: "flag", detail: `Reads as possibly generated or copied: ${flags.join("; ")}. This is a phrase check, not proof; ask the candidate to talk it through.`, quotes: copied.slice(0, 2).map((l) => short(l.trim())) }
        : { key: "generated", label: "Generated or copied text", status: "passed", detail: "No stock phrases or copied wording found. A phrase check can't prove who wrote an answer.", quotes: [] },
    );
  }

  // 6. Skill claims vs evidence: skills claimed in answers that the CV doesn't show.
  if (!answers.length || !claimed.length) out.push(none("skill_claims", "Skill claims vs evidence", !answers.length ? "No answers recorded yet." : "The answers don't name any of the role's skills."));
  else if (!cv.trim()) out.push(none("skill_claims", "Skill claims vs evidence", "No CV on file to compare with."));
  else {
    const notInCv = claimed.filter((s) => !mentions(cv, s));
    out.push(
      notInCv.length
        ? { key: "skill_claims", label: "Skill claims vs evidence", status: "flag", detail: `Claimed in the answers but not in the CV: ${notInCv.join(", ")}. Not wrong in itself; ask where they used it.`, quotes: [] }
        : { key: "skill_claims", label: "Skill claims vs evidence", status: "passed", detail: `The CV also shows ${claimed.join(", ")}.`, quotes: [] },
    );
  }
  return out;
}
