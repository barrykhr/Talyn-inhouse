import "server-only";
import type { AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";

export async function loadStage(auth: AuthContext, stageId: string) {
  const stage = await db.interviewStage.findFirst({
    where: { id: stageId, kit: { orgId: auth.orgId } },
    include: {
      assignments: { select: { interviewerId: true, interviewerName: true } },
      scheduling: true,
      kit: { include: { application: { include: { candidate: true, role: { select: { title: true } } } } } },
    },
  });
  return stage;
}
const plusDays = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);

export async function ensureScheduling(auth: AuthContext, stageId: string) {
  const stage = await loadStage(auth, stageId);
  if (!stage) return null;
  if (stage.scheduling) return stage;
  await db.interviewScheduling.create({
    data: {
      stageId,
      kitId: stage.kitId,
      interviewerIdsJson: JSON.stringify(stage.assignments.map((a) => a.interviewerId)),
      durationMins: stage.durationMins ?? 60,
      dateFrom: plusDays(1),
      dateTo: plusDays(10),
      candidateEmail: stage.kit.application.candidate.email,
      candidatePhone: stage.kit.application.candidate.phone,
      updatedByName: auth.userName,
    },
  });
  return loadStage(auth, stageId);
}


/** Display data for scheduled interviews, with what the viewer may do. */
export async function eventViews(auth: AuthContext, kit: { ownerId: string; hiringManagerId: string | null }, stageIds: string[], includeCancelled = false) {
  const events = await db.interviewEvent.findMany({ where: { orgId: auth.orgId, stageId: { in: stageIds }, ...(includeCancelled ? {} : { status: "scheduled" }) }, orderBy: { createdAt: "desc" } });
  const organizers = await db.user.findMany({ where: { id: { in: events.map((e) => e.organizerUserId) } }, select: { id: true, name: true } });
  const manage = auth.membershipRole === "admin" || auth.membershipRole === "hiring_manager" || kit.ownerId === auth.userId || kit.hiringManagerId === auth.userId;
  return events.map((e) => ({
    stageId: e.stageId,
    view: {
      id: e.id,
      mode: e.mode,
      status: e.status,
      startAt: e.startAt.toISOString(),
      endAt: e.endAt.toISOString(),
      timeZone: e.timeZone,
      attendees: JSON.parse(e.attendeesJson),
      meetUrl: e.meetUrl,
      meetStatus: e.meetStatus,
      htmlLink: e.htmlLink,
      meetingMethod: e.meetingMethod,
      locationNote: e.locationNote,
      organizerName: organizers.find((o) => o.id === e.organizerUserId)?.name ?? "Unknown",
      organizerEmail: e.organizerEmail,
      lastSyncedAt: e.lastSyncedAt?.toISOString() ?? null,
      lastError: e.lastError,
      canManage: manage || e.organizerUserId === auth.userId,
      isOrganizer: e.organizerUserId === auth.userId,
    },
  }));
}
