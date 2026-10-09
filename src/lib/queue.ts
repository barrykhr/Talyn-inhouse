import "server-only";
import { db } from "./db";

export type QueueItem = {
  key: string;
  candidateId: string;
  candidateName: string;
  roleId?: string;
  roleTitle?: string;
  since: Date; // when it started waiting for recruiter action
  detail?: string;
  href: string;
};

export type QueueSection = { key: string; title: string; hint: string; items: QueueItem[]; setup?: string };

const ACTIVE = { notIn: ["hired", "rejected"] };

/** Actionable recruiter work, oldest first. Every item links to where the action happens. */
export async function buildQueue(orgId: string): Promise<QueueSection[]> {
  const kits = await db.interviewKit.findMany({
    where: { orgId, status: "shared" },
    include: { application: { select: { candidate: { select: { id: true, fullName: true } }, role: { select: { id: true, title: true } } } }, stages: { include: { assignments: true } } },
    take: 200,
  });
  const [profiles, tasks, apps, sourced, dueMessages, atsConflicts, failedPushes] = await Promise.all([
    db.candidate.findMany({
      where: { orgId, extractionStatus: "needs_review" },
      select: { id: true, fullName: true, updatedAt: true, applications: { select: { roleId: true }, take: 1 } },
      orderBy: { updatedAt: "asc" },
      take: 100,
    }),
    db.task.findMany({
      where: { orgId, status: "open" },
      include: { application: { include: { candidate: { select: { id: true, fullName: true } }, role: { select: { id: true, title: true } } } } },
      orderBy: { createdAt: "asc" },
      take: 200,
    }),
    db.application.findMany({
      where: { orgId, stage: ACTIVE },
      include: {
        candidate: { select: { id: true, fullName: true } },
        role: { select: { id: true, title: true } },
        assessments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true, status: true, createdAt: true, reviewedAt: true, recommendation: true, recommendationStatus: true } },
      },
      take: 500,
    }),
    db.sourcedProfile.groupBy({ by: ["roleId"], where: { orgId, status: "new" }, _count: true, _min: { createdAt: true } }),
    db.outreachMessage.findMany({
      where: { orgId, status: "approved", sentAt: null, dueAt: { lte: new Date() }, sequence: { status: "active" } },
      include: { sequence: { include: { application: { include: { candidate: { select: { id: true, fullName: true } }, role: { select: { id: true, title: true } } } } } } },
      orderBy: { dueAt: "asc" },
      take: 200,
    }),
    db.atsConflict.groupBy({ by: ["candidateId"], where: { orgId, status: "open" }, _count: true, _min: { createdAt: true } }),
    db.atsOutbox.findMany({ where: { orgId, status: "failed" }, orderBy: { createdAt: "asc" }, take: 100 }),
  ]);
  const conflictCandidates = atsConflicts.length
    ? await db.candidate.findMany({ where: { orgId, id: { in: atsConflicts.map((c) => c.candidateId) } }, select: { id: true, fullName: true } })
    : [];
  const pushApps = failedPushes.length
    ? await db.application.findMany({ where: { orgId, id: { in: failedPushes.map((f) => f.applicationId) } }, select: { id: true, candidate: { select: { id: true, fullName: true } }, role: { select: { id: true, title: true } } } })
    : [];
  const sourcedRoles = sourced.length
    ? await db.role.findMany({ where: { orgId, id: { in: sourced.map((s) => s.roleId) } }, select: { id: true, title: true } })
    : [];

  const href = (cid: string, rid?: string) => `/candidates/${cid}${rid ? `?role=${rid}` : ""}`;
  const assessed = apps.filter((a) => a.assessments[0]);
  const byAge = (a: QueueItem, b: QueueItem) => a.since.getTime() - b.since.getTime();

  return [
    {
      key: "profile",
      title: "Needs profile review",
      hint: "CV details extracted and waiting for you to confirm or correct them.",
      items: profiles.map((c) => ({
        key: c.id,
        candidateId: c.id,
        candidateName: c.fullName,
        since: c.updatedAt,
        href: `${href(c.id, c.applications[0]?.roleId)}#cv-review`,
      })),
    },
    {
      key: "evidence",
      title: "Needs more evidence",
      hint: "Information requests you created. Completing one doesn't record a decision.",
      items: tasks
        .filter((t) => t.type === "gather_info")
        .map((t) => {
          const q = (JSON.parse(t.detailsJson) as { questions?: string[] }).questions ?? [];
          return {
            key: t.id,
            candidateId: t.application.candidate.id,
            candidateName: t.application.candidate.fullName,
            roleId: t.application.role.id,
            roleTitle: t.application.role.title,
            since: t.createdAt,
            detail: `${t.title}${q.length ? ` · ${q.length} question${q.length > 1 ? "s" : ""}` : ""}${t.dueAt ? ` · due ${t.dueAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}`,
            href: href(t.application.candidate.id, t.application.role.id),
          };
        }),
    },
    {
      key: "assessment",
      title: "Assessment ready",
      hint: "Drafted assessments whose evidence you haven't reviewed yet.",
      items: assessed
        .filter((a) => a.assessments[0].status !== "reviewed")
        .map((a) => ({
          key: a.id,
          candidateId: a.candidate.id,
          candidateName: a.candidate.fullName,
          roleId: a.role.id,
          roleTitle: a.role.title,
          since: a.assessments[0].createdAt,
          detail: a.assessments[0].recommendation && a.assessments[0].recommendationStatus === "pending" ? "AI recommendation awaiting review" : undefined,
          href: href(a.candidate.id, a.role.id),
        }))
        .sort(byAge),
    },
    {
      key: "decision",
      title: "Recruiter decision pending",
      hint: "Reviewed assessments with no Shortlist, Hold or Reject recorded.",
      items: assessed
        .filter((a) => a.assessments[0].status === "reviewed" && !a.decision)
        .map((a) => ({
          key: a.id,
          candidateId: a.candidate.id,
          candidateName: a.candidate.fullName,
          roleId: a.role.id,
          roleTitle: a.role.title,
          since: a.assessments[0].reviewedAt ?? a.assessments[0].createdAt,
          href: href(a.candidate.id, a.role.id),
        }))
        .sort(byAge),
    },
    {
      key: "outreach",
      title: "Outreach to send",
      hint: "Approved messages in active sequences that are due. No email provider is connected: send from your mail client, then record it.",
      items: dueMessages.map((m) => ({
        key: m.id,
        candidateId: m.sequence.application.candidate.id,
        candidateName: m.sequence.application.candidate.fullName,
        roleId: m.sequence.application.role.id,
        roleTitle: m.sequence.application.role.title,
        since: m.dueAt!,
        detail: `Step ${m.step}`,
        href: `${href(m.sequence.application.candidate.id, m.sequence.application.role.id)}&view=outreach`,
      })),
    },
    {
      key: "replied",
      title: "Candidate replied",
      hint: "Replies you recorded. Follow-ups were stopped automatically.",
      items: tasks
        .filter((t) => t.type === "reply")
        .map((t) => ({
          key: t.id,
          candidateId: t.application.candidate.id,
          candidateName: t.application.candidate.fullName,
          roleId: t.application.role.id,
          roleTitle: t.application.role.title,
          since: t.createdAt,
          detail: "Respond to the candidate",
          href: `${href(t.application.candidate.id, t.application.role.id)}&view=outreach`,
        })),
    },
    {
      key: "sourcing",
      title: "Discover results to review",
      hint: "Profiles from authorized sources waiting for save, dismiss or feedback.",
      items: sourced
        .map((g) => {
          const role = sourcedRoles.find((r) => r.id === g.roleId);
          return {
            key: g.roleId,
            candidateId: "",
            candidateName: `${g._count} profile${g._count === 1 ? "" : "s"} to review`,
            roleId: g.roleId,
            roleTitle: role?.title ?? "Role",
            since: g._min.createdAt ?? new Date(),
            href: `/roles/${g.roleId}/discover#results`,
          };
        })
        .sort(byAge),
    },
    {
      key: "ats",
      title: "ATS differences",
      hint: "The ATS has a different value than a person entered in Talyn. Nothing was overwritten.",
      items: atsConflicts
        .flatMap((g) => {
          const c = conflictCandidates.find((x) => x.id === g.candidateId);
          return c ? [{ key: g.candidateId, candidateId: c.id, candidateName: c.fullName, since: g._min.createdAt ?? new Date(), detail: `${g._count} field${g._count === 1 ? "" : "s"} to resolve`, href: `/candidates/${c.id}#ats-conflicts` }] : [];
        })
        .sort(byAge),
    },
    {
      key: "ats_push",
      title: "Stage changes not in the ATS",
      hint: "The ATS didn't accept these recruiter stage changes. Retry or update the ATS manually.",
      items: failedPushes.flatMap((f) => {
        const a = pushApps.find((x) => x.id === f.applicationId);
        return a
          ? [{ key: f.id, candidateId: a.candidate.id, candidateName: a.candidate.fullName, roleId: a.role.id, roleTitle: a.role.title, since: f.createdAt, detail: `${f.talynStage} → ${f.atsStage} · ${f.lastError ?? "failed"}`, href: "/settings/integrations" }]
          : [];
      }),
    },
    {
      key: "scorecards",
      title: "Interview scorecards not submitted",
      hint: "Assigned interviewers who haven't submitted. Feedback is collected independently before the debrief.",
      items: kits.flatMap((k) =>
        k.stages.flatMap((st) =>
          st.assignments
            .filter((a) => a.status !== "submitted")
            .map((a) => ({
              key: a.id,
              candidateId: k.application.candidate.id,
              candidateName: k.application.candidate.fullName,
              roleId: k.application.role.id,
              roleTitle: k.application.role.title,
              since: st.scheduledAt && st.scheduledAt < new Date() ? st.scheduledAt : k.sharedAt ?? k.createdAt,
              detail: `${a.interviewerName} · ${st.name}${a.status === "draft" ? " · draft saved" : ""}`,
              href: `/interviews/${k.id}`,
            })),
        ),
      ).sort(byAge),
    },
    {
      key: "debrief",
      title: "Debriefs ready for a team decision",
      hint: "Every scorecard is in and no decision is recorded. A person decides — Talyn doesn't.",
      items: kits
        .filter((k) => !k.decision && k.stages.some((st) => st.assignments.length) && k.stages.every((st) => st.assignments.every((a) => a.status === "submitted")))
        .map((k) => ({
          key: k.id,
          candidateId: k.application.candidate.id,
          candidateName: k.application.candidate.fullName,
          roleId: k.application.role.id,
          roleTitle: k.application.role.title,
          since: new Date(Math.max(...k.stages.flatMap((st) => st.assignments.map((a) => a.submittedAt?.getTime() ?? 0)))),
          detail: "All scorecards submitted",
          href: `/interviews/${k.id}/debrief`,
        }))
        .sort(byAge),
    },
  ];
}
