import "server-only";
import { db } from "./db";
import { buildQueue } from "./queue";
import { computeScore } from "./score";

// Product success measures (Phase 2). Each has an explicit definition and is computed from
// stored data. Values with too little data are reported as such — never extrapolated.

export type Measure = { group: string; name: string; definition: string; value: string | null; sample: number; note?: string };
const MIN_SAMPLE = 5;
const pctOf = (n: number, d: number) => (d >= MIN_SAMPLE ? `${Math.round((n / d) * 100)}%` : null);
const median = (xs: number[]) => {
  if (xs.length < MIN_SAMPLE) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)];
};
const hours = (h: number | null) => (h == null ? null : h < 48 ? `${Math.round(h)} h` : `${Math.round(h / 24)} days`);

export async function computeMeasures(orgId: string): Promise<Measure[]> {
  const [icps, profiles, items, latestAssessments, messages, tasks, queue] = await Promise.all([
    db.icp.findMany({ where: { orgId, approvedAt: { not: null } }, select: { roleId: true, approvedAt: true } }),
    db.sourcedProfile.findMany({ where: { orgId, status: { not: "excluded" } }, select: { source: true, status: true, roleId: true, reviewedAt: true, duplicateCandidateId: true, evidenceStatus: true, feedback: true, savedApplicationId: true } }),
    db.assessmentItem.count({ where: { assessment: { orgId } } }),
    db.assessment.findMany({ where: { orgId }, orderBy: { createdAt: "desc" }, distinct: ["applicationId"], select: { items: { select: { criterionName: true, importance: true, result: true, overrideResult: true } } }, take: 2000 }),
    db.outreachMessage.findMany({ where: { orgId }, select: { status: true, body: true, draftBody: true, subject: true, draftSubject: true, approvedAt: true, sentAt: true, sequenceId: true } }),
    db.task.findMany({ where: { orgId }, select: { status: true, createdAt: true, resolvedAt: true } }),
    buildQueue(orgId),
  ]);
  const corrected = await db.assessmentItem.count({ where: { assessment: { orgId }, overrideResult: { not: null } } });

  // 1. ICP → shortlist
  const firstSave = new Map<string, Date>();
  for (const p of profiles) if (p.status === "saved" && p.reviewedAt && (!firstSave.has(p.roleId) || p.reviewedAt < firstSave.get(p.roleId)!)) firstSave.set(p.roleId, p.reviewedAt);
  const icpToShortlist = icps
    .map((i) => {
      const s = firstSave.get(i.roleId);
      return s && i.approvedAt && s > i.approvedAt ? (s.getTime() - i.approvedAt.getTime()) / 3600000 : null;
    })
    .filter((x): x is number => x !== null);

  // 2. Save / contact rate by source
  const bySource = new Map<string, { shown: number; saved: number; contacted: number }>();
  const contactedApps = new Set(
    (await db.outreachSequence.findMany({ where: { orgId, activatedAt: { not: null } }, select: { applicationId: true } })).map((s) => s.applicationId),
  );
  for (const p of profiles) {
    const b = bySource.get(p.source) ?? { shown: 0, saved: 0, contacted: 0 };
    b.shown++;
    if (p.status === "saved") b.saved++;
    if (p.savedApplicationId && contactedApps.has(p.savedApplicationId)) b.contacted++;
    bySource.set(p.source, b);
  }
  const unranked = latestAssessments.filter(
    (a) => computeScore(a.items.map((i) => ({ name: i.criterionName, importance: i.importance, result: i.result, overrideResult: i.overrideResult }))).score === null,
  ).length;

  const drafted = messages.length;
  const approved = messages.filter((m) => m.approvedAt).length;
  const edited = messages.filter((m) => m.approvedAt && (m.body !== m.draftBody || m.subject !== m.draftSubject)).length;
  const sent = messages.filter((m) => m.sentAt).length;
  const outcome = (s: string) => messages.filter((m) => m.status === s).length;
  const resolved = tasks.filter((t) => t.status !== "open");
  const waits = queue.flatMap((s) => s.items.map((i) => (Date.now() - i.since.getTime()) / 3600000));

  const out: Measure[] = [
    {
      group: "Sourcing",
      name: "Time from approved ICP to reviewed shortlist",
      definition: "Median time from a role's ICP approval to the first sourced profile a recruiter saved to that role.",
      value: hours(median(icpToShortlist)),
      sample: icpToShortlist.length,
    },
    ...[...bySource.entries()].map(([src, b]) => ({
      group: "Sourcing",
      name: `Save rate · ${src === "talyn" ? "Talyn rediscovery" : src}`,
      definition: "Profiles saved to a role ÷ profiles shown (excluding those set aside by approved exclusions).",
      value: pctOf(b.saved, b.shown),
      sample: b.shown,
    })),
    ...[...bySource.entries()].map(([src, b]) => ({
      group: "Sourcing",
      name: `Contact rate · ${src === "talyn" ? "Talyn rediscovery" : src}`,
      definition: "Saved profiles whose application had an outreach sequence activated ÷ saved profiles.",
      value: pctOf(b.contacted, b.saved),
      sample: b.saved,
    })),
    {
      group: "Sourcing",
      name: "Duplicate rate",
      definition: "Sourced profiles flagged as a possible duplicate of an existing Talyn candidate ÷ profiles shown.",
      value: pctOf(profiles.filter((p) => p.duplicateCandidateId).length, profiles.length),
      sample: profiles.length,
    },
    {
      group: "Sourcing",
      name: "Stale / limited-evidence rate",
      definition: "Sourced profiles with a stale CV or no CV ÷ profiles shown.",
      value: pctOf(profiles.filter((p) => p.evidenceStatus !== "ok").length, profiles.length),
      sample: profiles.length,
    },
    { group: "Matching", name: "Match correction rate", definition: "Assessment criterion results corrected by a recruiter ÷ all assessed criterion results.", value: pctOf(corrected, items), sample: items },
    {
      group: "Matching",
      name: "Unranked rate",
      definition: "Applications whose latest assessment has a withheld score (insufficient evidence) ÷ applications with an assessment.",
      value: pctOf(unranked, latestAssessments.length),
      sample: latestAssessments.length,
    },
    { group: "Outreach", name: "Edit rate", definition: "Approved messages the recruiter changed from the draft ÷ approved messages.", value: pctOf(edited, approved), sample: approved },
    { group: "Outreach", name: "Approval rate", definition: "Drafted messages approved ÷ drafted messages.", value: pctOf(approved, drafted), sample: drafted },
    { group: "Outreach", name: "Reply rate", definition: "Messages marked replied ÷ messages sent.", value: pctOf(outcome("replied"), sent), sample: sent, note: "Recruiter-recorded (no email provider connected)." },
    { group: "Outreach", name: "Bounce rate", definition: "Messages marked bounced ÷ messages sent.", value: pctOf(outcome("bounced"), sent), sample: sent, note: "Recruiter-recorded." },
    { group: "Outreach", name: "Opt-out rate", definition: "Messages marked opted out ÷ messages sent.", value: pctOf(outcome("opted_out"), sent), sample: sent, note: "Recruiter-recorded." },
    {
      group: "Queue",
      name: "Task completion",
      definition: "Tasks completed or cancelled ÷ tasks created (information requests and reply follow-ups).",
      value: pctOf(resolved.length, tasks.length),
      sample: tasks.length,
    },
    {
      group: "Queue",
      name: "Time waiting for recruiter action",
      definition: "Median age of items currently in the review queue.",
      value: hours(median(waits)),
      sample: waits.length,
    },
    { group: "ATS", name: "ATS sync success / error rate", definition: "Successful sync runs ÷ all sync runs, per connector.", value: null, sample: 0, note: "No ATS connector is configured." },
  ];
  return out;
}
