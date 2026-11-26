// Timing: whether now looks like a good moment to reach out, from facts Talyn can show.
// It never says whether someone is interested or a good fit, and it never hides, filters or
// ranks anyone. Every point traces to a signal with its source.

export type YM = { y: number; m: number }; // m: 1–12

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** Dates as CVs write them: "Mar 2021", "March 2021", "03/2021", "2021-03", "2021", "Present". */
export function parseCvDate(raw: string | null | undefined): YM | "present" | null {
  const s = (raw ?? "").trim().toLowerCase();
  if (!s) return null;
  if (/^(present|current|now|today|ongoing|till date|to date)$/.test(s)) return "present";
  let m = s.match(/^([a-z]{3,9})\.?\s*'?(\d{2}|\d{4})$/);
  if (m) {
    const mi = MONTHS.indexOf(m[1].slice(0, 3));
    const y = m[2].length === 2 ? 2000 + Number(m[2]) : Number(m[2]);
    return mi >= 0 ? { y, m: mi + 1 } : null;
  }
  m = s.match(/^(\d{1,2})[/.-](\d{4})$/);
  if (m && Number(m[1]) >= 1 && Number(m[1]) <= 12) return { y: Number(m[2]), m: Number(m[1]) };
  m = s.match(/^(\d{4})[/.-](\d{1,2})$/);
  if (m && Number(m[2]) >= 1 && Number(m[2]) <= 12) return { y: Number(m[1]), m: Number(m[2]) };
  m = s.match(/^(\d{4})$/);
  if (m) return { y: Number(m[1]), m: 1 };
  return null;
}

const monthsBetween = (a: YM, b: YM) => (b.y - a.y) * 12 + (b.m - a.m);
const nowYM = (now: Date): YM => ({ y: now.getUTCFullYear(), m: now.getUTCMonth() + 1 });
export const fmtMonths = (n: number) => (n < 12 ? `${n} month${n === 1 ? "" : "s"}` : `${Math.floor(n / 12)}${n % 12 >= 6 ? "½" : ""} year${n >= 24 ? "s" : ""}`);

export type Job = { title: string; employer: string; start: string; end: string; quote?: string | null };
export type WorkFacts = {
  employer: string;
  title: string;
  inTitleMonths: number; // since the current title began
  atCompanyMonths: number; // since they joined the current employer (across titles)
  quote: string | null;
};

const sameEmployer = (a: string, b: string) => a.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ") === b.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ");

/** The current role from a CV's work history: needs an entry ending "Present" with a readable start. */
export function workFacts(history: Job[], now = new Date()): WorkFacts | null {
  const cur = history.map((j) => ({ ...j, s: parseCvDate(j.start), e: parseCvDate(j.end) })).filter((j) => j.e === "present" && j.s && j.s !== "present");
  if (!cur.length) return null;
  // The most recent current entry is the current title.
  const top = cur.sort((a, b) => monthsBetween(b.s as YM, a.s as YM))[0];
  const start = top.s as YM;
  let joined = start;
  for (const j of history) {
    const s = parseCvDate(j.start);
    if (s && s !== "present" && sameEmployer(j.employer, top.employer) && monthsBetween(s, joined) > 0) joined = s;
  }
  const n = nowYM(now);
  const inTitle = monthsBetween(start, n);
  if (inTitle < 0) return null;
  return { employer: top.employer, title: top.title, inTitleMonths: inTitle, atCompanyMonths: Math.max(inTitle, monthsBetween(joined, n)), quote: top.quote ?? null };
}

export type CompanyEvent = { type: "layoffs" | "restructuring" | "acquisition" | "leadership_change" | "funding" | "hiring_freeze" | "office_closure" | "other"; date: string; headline: string; url: string };
export const EVENT_LABEL: Record<CompanyEvent["type"], string> = {
  layoffs: "Layoffs",
  restructuring: "Restructuring",
  acquisition: "Acquisition or merger",
  leadership_change: "Leadership change",
  funding: "Funding",
  hiring_freeze: "Hiring freeze",
  office_closure: "Office closure",
  other: "Company news",
};
const EVENT_POINTS: Record<CompanyEvent["type"], number> = { layoffs: 30, restructuring: 25, hiring_freeze: 20, office_closure: 20, acquisition: 20, leadership_change: 10, funding: 0, other: 0 };

export type ProfileChange = { field: "title" | "company" | "location" | "headline"; from: string; to: string; seenAt: Date; source: string };

export type TimingInput = {
  work: WorkFacts | null;
  events: CompanyEvent[]; // the current employer's, with sources
  changes: ProfileChange[]; // what changed between searches Talyn ran
  saidInterested: boolean; // the candidate said so themselves
  now?: Date;
};

export type TimingSignal = { label: string; detail: string; points: number; source: string; url?: string };
export type TimingBand = "good" | "some" | "low" | "unknown";
export const TIMING_BAND_LABEL: Record<TimingBand, string> = { good: "Good time to reach out", some: "Some timing signals", low: "No strong timing signals", unknown: "Not enough to tell" };

/** 0–100 from the signals below, each shown with its points and source. Ordering aid for outreach only. */
export function timingScore(i: TimingInput): { score: number | null; band: TimingBand; signals: TimingSignal[] } {
  const now = i.now ?? new Date();
  const signals: TimingSignal[] = [];
  if (i.work) {
    const t = i.work.inTitleMonths;
    if (t >= 36) signals.push({ label: "Same title for a while", detail: `${fmtMonths(t)} as ${i.work.title} at ${i.work.employer}, no title change`, points: 25, source: "CV" });
    else if (t >= 24) signals.push({ label: "Same title for 2+ years", detail: `${fmtMonths(t)} as ${i.work.title} at ${i.work.employer}`, points: 15, source: "CV" });
    else if (t <= 9) signals.push({ label: "Recently started this role", detail: `${fmtMonths(t)} as ${i.work.title}`, points: -15, source: "CV" });
    else signals.push({ label: "Time in role", detail: `${fmtMonths(t)} as ${i.work.title} at ${i.work.employer}`, points: 0, source: "CV" });
  }
  const recent = i.events.filter((e) => {
    const d = parseCvDate(e.date);
    return d && d !== "present" && monthsBetween(d, nowYM(now)) <= 12 && monthsBetween(d, nowYM(now)) >= 0;
  });
  // Count the strongest event of each type once.
  const seen = new Set<string>();
  for (const e of recent.sort((a, b) => EVENT_POINTS[b.type] - EVENT_POINTS[a.type])) {
    if (seen.has(e.type)) continue;
    seen.add(e.type);
    signals.push({ label: EVENT_LABEL[e.type], detail: `${e.headline} (${e.date})`, points: EVENT_POINTS[e.type], source: "Company news", url: e.url });
  }
  const fresh = i.changes.filter((c) => now.getTime() - c.seenAt.getTime() <= 120 * 86_400_000);
  const moved = fresh.find((c) => c.field === "company");
  const retitled = fresh.find((c) => c.field === "title");
  const touched = fresh.find((c) => c.field === "headline" || c.field === "location");
  if (moved) signals.push({ label: "Just changed employer", detail: `${moved.from || "—"} → ${moved.to}`, points: -25, source: moved.source });
  else if (retitled) signals.push({ label: "New title", detail: `${retitled.from || "—"} → ${retitled.to}`, points: -10, source: retitled.source });
  if (touched) signals.push({ label: "Updated their public profile", detail: `${touched.field === "location" ? "Location" : "Headline"}: ${touched.from || "—"} → ${touched.to}`, points: 15, source: touched.source });
  if (i.saidInterested) signals.push({ label: "Said they're interested", detail: "In their own words, recorded by your team", points: 40, source: "Candidate" });
  if (!signals.length) return { score: null, band: "unknown", signals };
  const score = Math.max(0, Math.min(100, 30 + signals.reduce((s, x) => s + x.points, 0)));
  return { score, band: score >= 70 ? "good" : score >= 45 ? "some" : "low", signals };
}

/** Differences between two observations of the same public profile. */
export function profileDiff(prev: { currentTitle: string | null; currentCompany: string | null; location: string | null; headline?: string | null }, next: typeof prev, seenAt: Date, source: string): ProfileChange[] {
  const out: ProfileChange[] = [];
  const norm = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
  const pairs: [ProfileChange["field"], string | null | undefined, string | null | undefined][] = [
    ["company", prev.currentCompany, next.currentCompany],
    ["title", prev.currentTitle, next.currentTitle],
    ["location", prev.location, next.location],
    ["headline", prev.headline, next.headline],
  ];
  for (const [field, a, b] of pairs) if (norm(b) && norm(a) !== norm(b) && (norm(a) || field === "headline")) out.push({ field, from: (a ?? "").trim(), to: (b ?? "").trim(), seenAt, source });
  return out;
}
