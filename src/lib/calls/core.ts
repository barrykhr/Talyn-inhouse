// Pure logic behind role calls: no database, no AI, so it can be tested directly.
import { z } from "zod";

export type CallKind = "intake" | "screen" | "interview";
export const CALL_KIND_LABEL: Record<CallKind, string> = {
  intake: "Hiring manager intake",
  screen: "Recruiter screen",
  interview: "Interview",
};
export type InterviewerRole = "hiring_manager" | "recruiter" | "interviewer";
export const INTERVIEWER_ROLE_LABEL: Record<InterviewerRole, string> = {
  hiring_manager: "Hiring manager",
  recruiter: "Recruiter",
  interviewer: "Interviewer",
};
export type SpeakerRole = "candidate" | "interviewer" | "other";
export type Speaker = { label: string; role: SpeakerRole };
export type Segment = { startMs: number; endMs: number; speaker: string; text: string };
export type Passage = { n: number; at: string; speaker: string; role: SpeakerRole | "unknown"; text: string };

export function fmtMs(ms: number) {
  const s = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = String(s % 60).padStart(2, "0");
  return h ? `${h}:${String(m).padStart(2, "0")}:${sec}` : `${m}:${sec}`;
}

/** Distinct speaker labels in order of first appearance, with how much each spoke. */
export function speakersIn(segments: Segment[]): { label: string; passages: number; words: number }[] {
  const out = new Map<string, { label: string; passages: number; words: number }>();
  for (const s of segments) {
    const label = s.speaker.trim() || "Unlabelled";
    const cur = out.get(label) ?? { label, passages: 0, words: 0 };
    cur.passages += 1;
    cur.words += s.text.split(/\s+/).filter(Boolean).length;
    out.set(label, cur);
  }
  return [...out.values()];
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * A first guess at who is who, from names only: a label matching the candidate's name is the
 * candidate; one matching the interviewer's name is the interviewer. Everyone else stays "other"
 * for a person to set. Never guessed from how someone speaks.
 */
export function guessSpeakers(labels: string[], names: { candidate?: string | null; interviewer?: string | null }): Speaker[] {
  const matches = (label: string, name?: string | null) => {
    if (!name) return false;
    const l = norm(label);
    const parts = norm(name).split(" ").filter((p) => p.length > 1);
    return !!l && parts.length > 0 && (l === norm(name) || parts.some((p) => l.split(" ").includes(p)));
  };
  return labels.map((label) => ({
    label,
    role: matches(label, names.candidate) ? "candidate" : matches(label, names.interviewer) ? "interviewer" : "other",
  }));
}

export function passagesOf(segments: Segment[], speakers: Speaker[]): Passage[] {
  const role = new Map(speakers.map((s) => [s.label, s.role]));
  return segments.map((s, i) => ({ n: i + 1, at: fmtMs(s.startMs), speaker: s.speaker || "Unlabelled", role: role.get(s.speaker || "Unlabelled") ?? "unknown", text: s.text }));
}

const squash = (s: string) => s.toLowerCase().replace(/[“”"‘’'`]/g, "").replace(/\s+/g, " ").trim();

/** The passage number a quote really comes from, or null if the words aren't in the transcript. */
export function locateQuote(quote: string | null | undefined, passages: Passage[], hint?: number | null): number | null {
  const q = squash(quote ?? "");
  if (q.length < 4) return null;
  const hinted = hint ? passages.find((p) => p.n === hint) : undefined;
  if (hinted && squash(hinted.text).includes(q)) return hinted.n;
  return passages.find((p) => squash(p.text).includes(q))?.n ?? null;
}

// ---------- Scores (computed from labels, so a person can check every point) ----------

export type QuestionAlignment = "on_jd" | "partly" | "off_jd" | "risky";
export const QUESTION_ALIGNMENT_LABEL: Record<QuestionAlignment, string> = {
  on_jd: "Tied to the JD",
  partly: "Partly tied",
  off_jd: "Not in the JD",
  risky: "Avoid: personal or protected topic",
};

/** Share of the interviewer's questions tied to the JD: on = 1, partly = ½, off or risky = 0. Logistics are left out. */
export function questionAlignmentScore(questions: { alignment: QuestionAlignment; kind?: string }[]): number | null {
  const counted = questions.filter((q) => q.kind !== "logistics");
  if (!counted.length) return null;
  const points = counted.reduce((s, q) => s + (q.alignment === "on_jd" ? 1 : q.alignment === "partly" ? 0.5 : 0), 0);
  return Math.round((points / counted.length) * 100);
}

/** Share of essential criteria the interviewer asked about at least once. */
export function essentialCoverageScore(coverage: { essential: boolean; asked: boolean }[]): number | null {
  const ess = coverage.filter((c) => c.essential);
  if (!ess.length) return null;
  return Math.round((ess.filter((c) => c.asked).length / ess.length) * 100);
}

export type CandidateAlignment = "aligned" | "partly" | "not_aligned" | "not_discussed";
export const CANDIDATE_ALIGNMENT_LABEL: Record<CandidateAlignment, string> = {
  aligned: "Matches the JD",
  partly: "Partly matches",
  not_aligned: "Doesn't match",
  not_discussed: "Not discussed",
};
export function candidateCounts(items: { status: CandidateAlignment; essential: boolean }[]) {
  const ess = items.filter((i) => i.essential);
  return {
    essential: ess.length,
    aligned: ess.filter((i) => i.status === "aligned").length,
    partly: ess.filter((i) => i.status === "partly").length,
    notAligned: ess.filter((i) => i.status === "not_aligned").length,
    notDiscussed: ess.filter((i) => i.status === "not_discussed").length,
  };
}

export type AnswerRating = "strong" | "mixed" | "weak" | "not_answered";
export const ANSWER_RATING_LABEL: Record<AnswerRating, string> = {
  strong: "Strong against the benchmark",
  mixed: "Mixed",
  weak: "Below the benchmark",
  not_answered: "Asked, not really answered",
};

export type ExpectationStatus = "matches" | "adds" | "conflicts" | "not_in_jd";
export const EXPECTATION_LABEL: Record<ExpectationStatus, string> = {
  matches: "Matches the JD",
  adds: "Goes beyond the JD",
  conflicts: "Conflicts with the JD",
  not_in_jd: "Not in the JD",
};

// ---------- Company size ----------

export type CompanyStage = "early_startup" | "startup" | "scaleup" | "enterprise" | "unknown";
export const STAGE_LABEL: Record<CompanyStage, string> = {
  early_startup: "Early-stage startup (up to 50 people)",
  startup: "Startup (51–200 people)",
  scaleup: "Scale-up (201–1,000 people)",
  enterprise: "Large company (1,000+ people)",
  unknown: "Company size not known",
};
export function stageOf(headcountBand: string | null | undefined): CompanyStage {
  switch (headcountBand) {
    case "1-50":
      return "early_startup";
    case "51-200":
      return "startup";
    case "201-1,000":
      return "scaleup";
    case "1,001-5,000":
    case "5,001+":
      return "enterprise";
    default:
      return "unknown";
  }
}

// ---------- Company identity ----------

/** A stable key for a client company name: case, punctuation and legal suffixes don't split one company in two. */
export function companyKey(name: string | null | undefined): string {
  const base = (name ?? "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/\b(private|pvt|limited|ltd|inc|incorporated|llc|llp|corp|corporation|co|gmbh|plc)\b\.?/g, " ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base || "unnamed";
}

// ---------- Notetaker webhook contract ----------

const Seconds = z.number().finite().nonnegative();
export const NotetakerPayload = z
  .object({
    notetaker: z.string().max(60).optional(),
    external_id: z.string().min(1).max(200),
    title: z.string().max(300).default("Call"),
    started_at: z.string().datetime({ offset: true }).optional(),
    duration_seconds: Seconds.optional(),
    participants: z.array(z.object({ name: z.string().max(120), email: z.string().max(200).optional() })).max(50).default([]),
    role_id: z.string().max(60).optional(),
    candidate_email: z.string().max(200).optional(),
    segments: z
      .array(z.object({ speaker: z.string().max(120).default(""), start_seconds: Seconds, end_seconds: Seconds.optional(), text: z.string().max(20_000) }))
      .max(5_000)
      .optional(),
    transcript: z.string().max(1_500_000).optional(),
  })
  .refine((p) => (p.segments && p.segments.length > 0) || (p.transcript && p.transcript.trim().length > 0), { message: "Send segments or a transcript" });
export type NotetakerCall = z.infer<typeof NotetakerPayload>;

/** Segments from a notetaker's own timestamps, in order. Text-only transcripts go through the file parser instead. */
export function segmentsFromPayload(p: NotetakerCall): Segment[] | null {
  if (!p.segments?.length) return null;
  const sorted = [...p.segments].filter((s) => s.text.trim()).sort((a, b) => a.start_seconds - b.start_seconds);
  return sorted.map((s, i) => {
    const start = Math.round(s.start_seconds * 1000);
    const next = sorted.at(i + 1);
    const end = Math.round((s.end_seconds ?? next?.start_seconds ?? s.start_seconds) * 1000);
    return { startMs: start, endMs: Math.max(start, end), speaker: s.speaker.trim(), text: s.text.trim() };
  });
}

// ---------- Hiring manager and company profile ----------

export type ProfileCall = {
  callId: string;
  roleId: string;
  roleTitle: string;
  kind: CallKind;
  interviewerName: string | null;
  interviewerRole: InterviewerRole;
  occurredAt: Date | null;
  questionAlignment: number | null;
  essentialCoverage: number | null;
  questions: { alignment: QuestionAlignment; kind: string; criterionName: string | null; question: string }[];
  coverage: { criterionName: string; essential: boolean; asked: boolean }[];
  expectations: { status: ExpectationStatus; topic: string }[];
};

export type ManagerProfile = {
  name: string;
  role: InterviewerRole;
  calls: number;
  interviews: number;
  intakes: number;
  questionAlignment: number | null; // mean over calls with a score
  essentialCoverage: number | null;
  questionsAsked: number;
  mix: { kind: string; count: number }[];
  focus: { criterion: string; times: number }[]; // criteria they ask about most
  skipped: { criterion: string; skippedIn: number; of: number }[]; // essential criteria they often don't ask about
  offJd: number;
  risky: { question: string; callId: string }[];
  drift: { topic: string; status: ExpectationStatus; callId: string }[];
  roles: string[];
};

const mean = (xs: (number | null)[]) => {
  const v = xs.filter((x): x is number => x !== null);
  return v.length ? Math.round(v.reduce((a, b) => a + b, 0) / v.length) : null;
};

/** How each hiring manager interviews, counted from analysed calls. Facts only; nothing is inferred about the person. */
export function managerProfiles(calls: ProfileCall[]): ManagerProfile[] {
  const by = new Map<string, ProfileCall[]>();
  for (const c of calls) {
    const name = c.interviewerName?.trim();
    if (!name) continue;
    const k = norm(name);
    by.set(k, [...(by.get(k) ?? []), c]);
  }
  const out: ManagerProfile[] = [];
  for (const group of by.values()) {
    const interviews = group.filter((c) => c.kind !== "intake");
    const qs = interviews.flatMap((c) => c.questions);
    const mix = new Map<string, number>();
    for (const q of qs) mix.set(q.kind, (mix.get(q.kind) ?? 0) + 1);
    const focus = new Map<string, number>();
    for (const q of qs) if (q.criterionName && q.alignment !== "off_jd" && q.alignment !== "risky") focus.set(q.criterionName, (focus.get(q.criterionName) ?? 0) + 1);
    const skip = new Map<string, { skippedIn: number; of: number }>();
    for (const c of interviews)
      for (const cov of c.coverage.filter((x) => x.essential)) {
        const cur = skip.get(cov.criterionName) ?? { skippedIn: 0, of: 0 };
        cur.of += 1;
        if (!cov.asked) cur.skippedIn += 1;
        skip.set(cov.criterionName, cur);
      }
    out.push({
      name: group[0].interviewerName!.trim(),
      role: group[0].interviewerRole,
      calls: group.length,
      interviews: interviews.length,
      intakes: group.length - interviews.length,
      questionAlignment: mean(interviews.map((c) => c.questionAlignment)),
      essentialCoverage: mean(interviews.map((c) => c.essentialCoverage)),
      questionsAsked: qs.length,
      mix: [...mix].map(([kind, count]) => ({ kind, count })).sort((a, b) => b.count - a.count),
      focus: [...focus].map(([criterion, times]) => ({ criterion, times })).sort((a, b) => b.times - a.times).slice(0, 5),
      skipped: [...skip]
        .map(([criterion, v]) => ({ criterion, ...v }))
        .filter((s) => s.skippedIn > 0 && s.skippedIn / s.of >= 0.5)
        .sort((a, b) => b.skippedIn / b.of - a.skippedIn / a.of),
      offJd: qs.filter((q) => q.alignment === "off_jd").length,
      risky: interviews.flatMap((c) => c.questions.filter((q) => q.alignment === "risky").map((q) => ({ question: q.question, callId: c.callId }))),
      drift: group.flatMap((c) => c.expectations.filter((e) => e.status === "adds" || e.status === "conflicts" || e.status === "not_in_jd").map((e) => ({ topic: e.topic, status: e.status, callId: c.callId }))),
      roles: [...new Set(group.map((c) => c.roleTitle))],
    });
  }
  return out.sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));
}

/** Plain sentences describing how a hiring manager interviews, each built from counts shown beside it. */
export function managerSummary(p: ManagerProfile): string[] {
  const lines: string[] = [];
  if (p.interviews && p.questionAlignment !== null) lines.push(`${p.questionAlignment}% of their questions tie to the JD, across ${p.interviews} interview${p.interviews === 1 ? "" : "s"}.`);
  if (p.essentialCoverage !== null) lines.push(`They ask about ${p.essentialCoverage}% of a role's essential criteria on average.`);
  const top = p.mix.at(0);
  if (top && p.questionsAsked >= 5) lines.push(`Most of their questions are ${top.kind} (${top.count} of ${p.questionsAsked}).`);
  // One interview is a single example, not a habit: say what happened, not what they "often" do.
  const one = p.interviews === 1;
  if (p.focus.length) lines.push(`${one ? "In their interview they asked most about" : "They come back most to"} ${p.focus.slice(0, 3).map((f) => f.criterion).join(", ")}.`);
  if (p.skipped.length)
    lines.push(one ? `In their interview they didn't ask about ${p.skipped.slice(0, 3).map((s) => s.criterion).join(", ")}.` : `They often skip ${p.skipped.slice(0, 3).map((s) => `${s.criterion} (${s.skippedIn} of ${s.of})`).join(", ")}.`);
  if (p.drift.length) lines.push(`In intake calls they described ${p.drift.length} expectation${p.drift.length === 1 ? "" : "s"} that go beyond or differ from the JD.`);
  if (p.risky.length) lines.push(`${p.risky.length} question${p.risky.length === 1 ? "" : "s"} touched personal or protected topics; review them with the hiring manager.`);
  return lines;
}
