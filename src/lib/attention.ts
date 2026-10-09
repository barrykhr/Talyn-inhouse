import "server-only";
import { cache } from "react";
import { db } from "./db";

export type AttentionItem = { key: string; title: string; detail: string; href: string; action: string; at: Date | null };
export type AttentionGroup = { key: string; label: string; hint: string; items: AttentionItem[] };

const ACTIVE = { notIn: ["hired", "rejected"] };

/**
 * Work waiting on a person in this workspace, grouped by the next action, each linked to the
 * exact screen where it happens. Real counts only — nothing estimated.
 */
export const attention = cache(async (orgId: string): Promise<AttentionGroup[]> => {
  const [applicants, discovered, draftMsgs, dueMsgs, replies, profiles, proposed, kits] = await Promise.all([
    db.application.groupBy({ by: ["roleId"], where: { orgId, origin: "applied", decision: null, stage: ACTIVE }, _count: true, _min: { createdAt: true } }),
    db.sourcedProfile.groupBy({ by: ["roleId"], where: { orgId, status: "new" }, _count: true, _min: { createdAt: true } }),
    db.outreachMessage.findMany({
      where: { orgId, status: "draft", sentAt: null, sequence: { status: { in: ["draft", "paused"] } } },
      select: { sequenceId: true, createdAt: true, sequence: { select: { application: { select: { roleId: true, candidate: { select: { id: true, fullName: true } } } } } } },
      take: 200,
    }),
    db.outreachMessage.findMany({
      where: { orgId, status: "approved", sentAt: null, dueAt: { lte: new Date() }, sequence: { status: "active" } },
      select: { id: true, dueAt: true, sequence: { select: { channel: true, application: { select: { roleId: true, candidate: { select: { id: true, fullName: true } } } } } } },
      take: 100,
    }),
    db.task.findMany({ where: { orgId, status: "open", type: "reply" }, select: { id: true, createdAt: true, application: { select: { roleId: true, candidate: { select: { id: true, fullName: true } } } } }, take: 100 }),
    db.candidate.findMany({ where: { orgId, extractionStatus: "needs_review" }, select: { id: true, fullName: true, updatedAt: true }, take: 50 }),
    db.criterion.groupBy({ by: ["roleId"], where: { orgId, status: "proposed" }, _count: true }),
    db.interviewKit.findMany({
      where: { orgId },
      select: {
        id: true,
        status: true,
        decision: true,
        sharedAt: true,
        application: { select: { candidate: { select: { fullName: true } }, role: { select: { title: true } } } },
        stages: { select: { id: true, name: true, scheduledAt: true, assignments: { select: { status: true, submittedAt: true, interviewerName: true } }, events: { where: { status: "scheduled" }, select: { id: true } } } },
      },
      take: 200,
    }),
  ]);
  const roleIds = [...new Set([...applicants, ...discovered, ...proposed].map((x) => x.roleId))];
  const roles = roleIds.length ? await db.role.findMany({ where: { orgId, id: { in: roleIds } }, select: { id: true, title: true } }) : [];
  const title = (id: string) => roles.find((r) => r.id === id)?.title ?? "Role";

  const bySeq = new Map<string, (typeof draftMsgs)[number][]>();
  for (const m of draftMsgs) bySeq.set(m.sequenceId, [...(bySeq.get(m.sequenceId) ?? []), m]);

  const groups: AttentionGroup[] = [
    {
      key: "applicants",
      label: "Applicants awaiting review",
      hint: "People who applied and have no Shortlist, Hold or Reject decision yet.",
      items: applicants.map((g) => ({ key: g.roleId, title: title(g.roleId), detail: `${g._count} applicant${g._count === 1 ? "" : "s"} without a decision`, href: `/roles/${g.roleId}?tab=applicants`, action: "Review", at: g._min.createdAt })),
    },
    {
      key: "criteria",
      label: "Criteria to approve",
      hint: "Proposed criteria aren't used in assessments until a recruiter approves them.",
      items: proposed.map((g) => ({ key: g.roleId, title: title(g.roleId), detail: `${g._count} proposed criteri${g._count === 1 ? "on" : "a"}`, href: `/roles/${g.roleId}?tab=criteria`, action: "Review", at: null })),
    },
    {
      key: "profiles",
      label: "CV details to confirm",
      hint: "Details read from a CV, waiting for a recruiter to confirm or correct.",
      items: profiles.map((c) => ({ key: c.id, title: c.fullName, detail: "Extracted CV details", href: `/candidates/${c.id}#cv-review`, action: "Confirm", at: c.updatedAt })),
    },
    {
      key: "discover",
      label: "Discovery results ready",
      hint: "People found by a search, with evidence, waiting for you to save or dismiss.",
      items: discovered.map((g) => ({ key: g.roleId, title: title(g.roleId), detail: `${g._count} result${g._count === 1 ? "" : "s"} to review`, href: `/roles/${g.roleId}/discover#results`, action: "Review", at: g._min.createdAt })),
    },
    {
      key: "outreach_drafts",
      label: "Outreach drafts awaiting approval",
      hint: "Nothing is sent until a recruiter approves every message and activates the sequence.",
      items: [...bySeq.entries()].map(([seqId, ms]) => {
        const a = ms[0].sequence.application;
        return { key: seqId, title: a.candidate.fullName, detail: `${ms.length} message${ms.length === 1 ? "" : "s"} to approve`, href: `/candidates/${a.candidate.id}?role=${a.roleId}&view=outreach`, action: "Approve", at: ms[0].createdAt };
      }),
    },
    {
      key: "outreach_due",
      label: "Outreach due to send",
      hint: "Approved messages whose time has come. Without a connected provider you send them yourself and record it.",
      items: dueMsgs.map((m) => ({ key: m.id, title: m.sequence.application.candidate.fullName, detail: `${m.sequence.channel === "whatsapp" ? "WhatsApp" : "Email"} message due`, href: `/candidates/${m.sequence.application.candidate.id}?role=${m.sequence.application.roleId}&view=outreach`, action: "Send", at: m.dueAt })),
    },
    {
      key: "replies",
      label: "Candidates who replied",
      hint: "Follow-ups stopped. Respond and record what they said.",
      items: replies.map((t) => ({ key: t.id, title: t.application.candidate.fullName, detail: "Reply recorded", href: `/candidates/${t.application.candidate.id}?role=${t.application.roleId}&view=outreach`, action: "Respond", at: t.createdAt })),
    },
    {
      key: "interviews",
      label: "Interviews to schedule or follow up",
      hint: "Stages without a time, scorecards not yet submitted, and debriefs ready for a human decision.",
      items: kits.flatMap((k) => {
        const who = `${k.application.candidate.fullName} · ${k.application.role.title}`;
        const out: AttentionItem[] = [];
        if (k.status !== "shared") return [{ key: `${k.id}-draft`, title: who, detail: "Interview plan is a draft — share it with interviewers", href: `/interviews/${k.id}`, action: "Open plan", at: null }];
        for (const st of k.stages) {
          if (st.assignments.length && !st.scheduledAt && !st.events.length) out.push({ key: `${st.id}-sched`, title: who, detail: `${st.name} isn't scheduled`, href: `/interviews/${k.id}/schedule/${st.id}`, action: "Schedule", at: k.sharedAt });
        }
        const pending = k.stages.flatMap((st) => st.assignments.filter((a) => a.status !== "submitted"));
        const all = k.stages.flatMap((st) => st.assignments);
        if (pending.length) out.push({ key: `${k.id}-cards`, title: who, detail: `${pending.length} scorecard${pending.length === 1 ? "" : "s"} not submitted (${pending.map((p) => p.interviewerName).join(", ")})`, href: `/interviews/${k.id}`, action: "Follow up", at: k.sharedAt });
        else if (all.length && !k.decision) out.push({ key: `${k.id}-debrief`, title: who, detail: "All feedback in — ready for the team decision", href: `/interviews/${k.id}/debrief`, action: "Debrief", at: null });
        return out;
      }),
    },
  ];
  return groups.filter((g) => g.items.length);
});

export async function attentionCount(orgId: string) {
  return (await attention(orgId)).reduce((n, g) => n + g.items.length, 0);
}
