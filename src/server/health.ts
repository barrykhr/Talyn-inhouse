import "server-only";
import { db } from "@/lib/db";
import { candidateHealth, type Health } from "@/lib/health";

/** Health for each application, from recorded activity only. Closed applications get null. */
export async function loadHealth(orgId: string, applicationIds: string[], now = new Date()): Promise<Map<string, Health | null>> {
  const out = new Map<string, Health | null>();
  if (!applicationIds.length) return out;
  const ids = applicationIds.slice(0, 500);
  const [apps, stageEvents, assessments, messages, replyEvents, tasks] = await Promise.all([
    db.application.findMany({
      where: { orgId, id: { in: ids } },
      select: { id: true, stage: true, decision: true, interest: true, createdAt: true, candidate: { select: { contactOptOut: true } } },
    }),
    db.stageEvent.findMany({ where: { orgId, applicationId: { in: ids } }, select: { applicationId: true, toStage: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    db.assessment.findMany({ where: { orgId, applicationId: { in: ids } }, select: { applicationId: true, createdAt: true }, orderBy: { createdAt: "desc" } }),
    db.outreachMessage.findMany({ where: { orgId, applicationId: { in: ids }, sentAt: { not: null } }, select: { applicationId: true, sentAt: true, status: true } }),
    db.outreachEvent.findMany({ where: { orgId, type: "replied", sequence: { applicationId: { in: ids } } }, select: { createdAt: true, sequence: { select: { applicationId: true } } } }),
    db.task.findMany({ where: { orgId, applicationId: { in: ids } }, select: { applicationId: true, status: true, dueAt: true, agentReplyAt: true } }),
  ]);
  const first = <T extends { applicationId: string }>(rows: T[]) => {
    const m = new Map<string, T>();
    for (const r of rows) if (!m.has(r.applicationId)) m.set(r.applicationId, r);
    return m;
  };
  const latestAssessment = first(assessments);
  for (const a of apps) {
    const stageSince = stageEvents.find((e) => e.applicationId === a.id && e.toStage === a.stage)?.createdAt ?? a.createdAt;
    const sent = messages.filter((m) => m.applicationId === a.id);
    const replies = [
      ...replyEvents.filter((e) => e.sequence.applicationId === a.id).map((e) => e.createdAt),
      ...tasks.filter((t) => t.applicationId === a.id && t.agentReplyAt).map((t) => t.agentReplyAt!),
    ].sort((x, y) => y.getTime() - x.getTime());
    const lastReplyAt = replies[0] ?? null;
    const sentTimes = sent.map((m) => m.sentAt!).sort((x, y) => y.getTime() - x.getTime());
    const open = tasks.filter((t) => t.applicationId === a.id && t.status === "open");
    out.set(
      a.id,
      candidateHealth(
        {
          stage: a.stage,
          stageSince,
          decision: a.decision,
          assessedAt: latestAssessment.get(a.id)?.createdAt ?? null,
          lastContactAt: sentTimes[0] ?? null,
          lastReplyAt,
          unansweredSent: sentTimes.filter((t) => !lastReplyAt || t > lastReplyAt).length,
          openTasks: open.length,
          overdueTasks: open.filter((t) => t.dueAt && t.dueAt < now).length,
          interest: a.interest,
          optedOut: a.candidate.contactOptOut,
          bounced: sent.some((m) => m.status === "bounced"),
        },
        now,
      ),
    );
  }
  return out;
}
