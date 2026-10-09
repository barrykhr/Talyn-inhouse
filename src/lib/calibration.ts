import "server-only";
import { db } from "./db";
import { parseEvidence } from "./evidence";
import { computeScore, weightsOf } from "./score";
import { matchForApplication, roleSkillConfig, THRESHOLD_LABEL } from "./skills";

// Calibration from what recruiters actually did: corrections, outcomes and interview evidence.
// Descriptive only — nothing here changes how assessments are produced.

export const MIN_SAMPLE = 5;
const NOT_ENOUGH = new Set(["not_stated", "inferred", "partially_supported"]);
const POSITIVE = new Set(["supported", "partially_supported"]);
const NEGATIVE = new Set(["not_stated", "confirmed_absent", "conflicting"]);
export const rate = (n: number, d: number) => (d >= MIN_SAMPLE ? `${Math.round((n / d) * 100)}%` : null);

export async function calibration(orgId: string, days: number) {
  const since = new Date(Date.now() - days * 86400000);
  const [items, corrections, apps] = await Promise.all([
    db.assessmentItem.findMany({
      where: { assessment: { orgId, createdAt: { gte: since } } },
      select: { id: true, criterionName: true, kind: true, result: true, overrideResult: true, evidenceJson: true, assessment: { select: { generator: true } } },
      take: 50000,
    }),
    db.assessmentCorrection.findMany({ where: { orgId, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 20000 }),
    db.application.findMany({
      where: { orgId, assessments: { some: { createdAt: { gte: since } } }, candidate: { isSample: false } },
      select: {
        id: true,
        roleId: true,
        decision: true,
        sourcedProfileId: true,
        candidate: { select: { fullName: true, currentTitle: true, currentCompany: true, candidateSummary: true, resumes: { where: { isCurrent: true }, select: { id: true }, take: 1 } } },
        role: { select: { title: true } },
        assessments: {
          orderBy: { createdAt: "desc" },
          select: { id: true, createdAt: true, generator: true, criteriaSnapshot: true, criteriaVersion: true, resumeId: true, profileHash: true, items: { select: { id: true, criterionId: true, criterionName: true, kind: true, importance: true, result: true, overrideResult: true } } },
        },
        interviewKit: { select: { status: true, stages: { select: { assignments: { select: { submittedAt: true } } } } } },
      },
      take: 5000,
    }),
  ]);

  // 1–2. Per criterion: corrections and "not enough evidence".
  const byName = new Map<string, { name: string; kind: string; total: number; corrected: Set<string>; notEnough: number }>();
  for (const i of items) {
    const k = `${i.kind}|${i.criterionName}`;
    const row = byName.get(k) ?? { name: i.criterionName, kind: i.kind, total: 0, corrected: new Set<string>(), notEnough: 0 };
    row.total++;
    if (NOT_ENOUGH.has(i.overrideResult ?? i.result)) row.notEnough++;
    byName.set(k, row);
  }
  for (const c of corrections) byName.get(`${c.kind}|${c.criterionName}`)?.corrected.add(c.itemId);
  const criteria = [...byName.values()]
    .map((r) => ({ name: r.name, kind: r.kind, total: r.total, corrected: r.corrected.size, notEnough: r.notEnough }))
    .sort((a, b) => b.corrected - a.corrected || b.notEnough - a.notEnough)
    .slice(0, 25);

  // 3. Evidence that recruiters overruled, by where it came from and what produced it.
  const itemById = new Map(items.map((i) => [i.id, i]));
  const latestPerItem = new Map<string, (typeof corrections)[number]>();
  for (const c of corrections) if (!latestPerItem.has(c.itemId)) latestPerItem.set(c.itemId, c);
  const evidence = new Map<string, { label: string; checked: number; overruled: number; missed: number }>();
  const srcLabel: Record<string, string> = { resume: "CV excerpt", profile: "Candidate-provided information", source: "Linked source record", none: "No excerpt" };
  for (const i of items) {
    const sources = [...new Set(parseEvidence(i.evidenceJson).map((e) => e.source as string))];
    const keys = (sources.length ? sources : ["none"]).map((s) => `${i.assessment.generator}|${s}`);
    const c = latestPerItem.get(i.id);
    for (const key of keys) {
      const [gen, s] = key.split("|");
      const row = evidence.get(key) ?? { label: `${srcLabel[s] ?? s} · ${gen === "ai" ? "AI assessment" : "keyword check"}`, checked: 0, overruled: 0, missed: 0 };
      row.checked++;
      if (c && c.toResult) {
        if (POSITIVE.has(c.engineResult) && NEGATIVE.has(c.toResult)) row.overruled++;
        if (NEGATIVE.has(c.engineResult) && POSITIVE.has(c.toResult)) row.missed++;
      }
      evidence.set(key, row);
    }
  }

  // 4. Outcomes by band (latest assessment per application).
  const roleIds = [...new Set(apps.map((a) => a.roleId))];
  const roles = await db.role.findMany({ where: { orgId, id: { in: roleIds } }, select: { id: true, skillThreshold: true, skillPartialCredit: true, weightRequired: true, weightPreferred: true, criteriaVersion: true, criteria: { where: { status: "approved" }, select: { id: true, kind: true, importance: true, status: true, updatedAt: true } } } });
  const roleById = new Map(roles.map((r) => [r.id, r]));
  type Band = { label: string; n: number; shortlisted: number; interviewed: number };
  const skillBands = new Map<string, Band>();
  const alignBands = new Map<string, Band>();
  const bump = (m: Map<string, Band>, label: string, a: (typeof apps)[number]) => {
    const b = m.get(label) ?? { label, n: 0, shortlisted: 0, interviewed: 0 };
    b.n++;
    if (a.decision === "advance") b.shortlisted++;
    if (a.interviewKit && a.interviewKit.status === "shared") b.interviewed++;
    m.set(label, b);
  };
  for (const a of apps) {
    const r = roleById.get(a.roleId);
    const latest = a.assessments[0];
    if (!r || !latest) continue;
    const m = matchForApplication(a, { config: roleSkillConfig(r, r.criteria), approved: r.criteria, criteriaVersion: r.criteriaVersion });
    if (m.state !== "no_skills") bump(skillBands, THRESHOLD_LABEL[m.state], a);
    const s = computeScore(latest.items.map((i) => ({ name: i.criterionName, importance: i.importance, result: i.result, overrideResult: i.overrideResult, kind: i.kind })), weightsOf(r));
    bump(alignBands, s.score === null ? "Withheld (not enough evidence)" : s.score >= 75 ? "75–100" : s.score >= 50 ? "50–74" : "0–49", a);
  }

  // 5. Assessments that changed after interview evidence arrived.
  const afterInterview: { candidate: string; role: string; applicationId: string; firstScorecard: Date; change: string }[] = [];
  const corrByApp = new Map<string, typeof corrections>();
  for (const c of corrections) corrByApp.set(c.applicationId, [...(corrByApp.get(c.applicationId) ?? []), c]);
  for (const a of apps) {
    const subs = (a.interviewKit?.stages ?? []).flatMap((s) => s.assignments.map((x) => x.submittedAt)).filter((d): d is Date => !!d);
    if (!subs.length) continue;
    const first = new Date(Math.min(...subs.map((d) => d.getTime())));
    const newer = a.assessments.filter((x) => x.createdAt > first).length;
    const corr = (corrByApp.get(a.id) ?? []).filter((c) => c.createdAt > first);
    if (newer || corr.length)
      afterInterview.push({
        candidate: a.candidate.fullName,
        role: a.role.title,
        applicationId: a.id,
        firstScorecard: first,
        change: [newer ? `${newer} reassessment${newer === 1 ? "" : "s"}` : "", corr.length ? `${corr.length} correction${corr.length === 1 ? "" : "s"} (${[...new Set(corr.map((c) => c.criterionName))].slice(0, 3).join(", ")})` : ""].filter(Boolean).join(" · "),
      });
  }
  const withInterviewEvidence = apps.filter((a) => (a.interviewKit?.stages ?? []).some((s) => s.assignments.some((x) => x.submittedAt))).length;

  return {
    since,
    days,
    itemsTotal: items.length,
    correctionsTotal: corrections.length,
    applications: apps.length,
    criteria,
    evidence: [...evidence.values()].sort((a, b) => b.overruled + b.missed - (a.overruled + a.missed)),
    skillBands: [...skillBands.values()],
    alignBands: [...alignBands.values()],
    afterInterview,
    withInterviewEvidence,
  };
}
