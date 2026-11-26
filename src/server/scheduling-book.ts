import "server-only";
import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth";
import { calendarConfigured, createEvent, errorMessage, freeBusy, meetFrom, type GEvent } from "@/lib/calendar/google";
import { overlaps, type Window } from "@/lib/calendar/time";
import { db } from "@/lib/db";
import type { ActionState } from "./form";
import { ensureScheduling } from "./scheduling-store";

// Booking core, shared by the recruiter's "Schedule" and a candidate picking a proposed time.
// Server-only: never callable from the browser with someone else's identity.

const METHOD_LABEL: Record<string, string> = { meet: "Google Meet", phone: "Phone", in_person: "In person", other: "Other" };

const refresh = (kitId: string, stageId: string) => {
  revalidatePath(`/interviews/${kitId}`);
  revalidatePath(`/interviews/${kitId}/schedule/${stageId}`);
  revalidatePath("/interviews");
};

/** Re-checks free/busy for calendar-backed interviewers right before writing an event. */
export async function recheck(auth: AuthContext, ids: string[], start: number, end: number, ignore?: { start: number; end: number }) {
  if (!calendarConfigured()) return [];
  const users = await db.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } });
  const conns = await db.calendarConnection.findMany({ where: { orgId: auth.orgId, userId: { in: ids }, status: "connected" } });
  const conflicts: string[] = [];
  for (const u of users) {
    if (!conns.some((c) => c.userId === u.id)) continue; // unknown/manual: nothing to recheck
    const r = await freeBusy(auth.orgId, u.id, ["primary"], new Date(start), new Date(end));
    const p = r.primary;
    // When rescheduling, the interview's own current slot shows as busy — ignore exactly that block.
    if (p.ok && p.busy.some((b: { start: number; end: number }) => overlaps(b, { start, end }) && !(ignore && b.start >= ignore.start && b.end <= ignore.end))) conflicts.push(u.name);
  }
  return conflicts;
}

export type ScheduleInput = { start: number; requestKey: string; acceptUnknown: boolean };

/**
 * Creates the interview — only on the recruiter's explicit confirmation. Live: one Google Calendar
 * event on the scheduler's calendar with the candidate and interviewers invited (Google sends the
 * invitations) and a new Meet link when requested. Demo: a simulated event, labeled as such.
 * Retries with the same requestKey return the existing event instead of creating another.
 */
export async function bookInterview(auth: AuthContext, stageId: string, input: ScheduleInput): Promise<ActionState> {
  if (!/^[\w-]{16,80}$/.test(input.requestKey)) return { error: "Invalid request." };
  const dup = await db.interviewEvent.findUnique({ where: { requestKey: input.requestKey } });
  if (dup) return { ok: true, message: "Already scheduled." };
  const stage = await ensureScheduling(auth, stageId);
  if (!stage?.scheduling) return { error: "Stage not found." };
  const s = stage.scheduling;
  const active = await db.interviewEvent.findFirst({ where: { stageId, status: "scheduled" } });
  if (active) return { error: "This stage already has a scheduled interview. Reschedule or cancel it instead." };
  if (!s.candidateEmail) return { error: "Add the candidate's email address — they're invited as an attendee." };
  const c = stage.kit.application.candidate;
  if (c.contactOptOut) return { error: "The candidate opted out of contact." };
  const ids = JSON.parse(s.interviewerIdsJson) as string[];
  const users = await db.user.findMany({ where: { id: { in: ids }, memberships: { some: { orgId: auth.orgId } } }, select: { id: true, name: true, email: true } });
  if (!users.length) return { error: "Choose interviewers first." };
  const start = input.start;
  const end = start + s.durationMins * 60000;
  if (!Number.isFinite(start) || start < Date.now()) return { error: "Choose a time in the future." };
  const live = calendarConfigured();
  const attendees = [{ email: s.candidateEmail, name: c.fullName, kind: "candidate" }, ...users.map((u) => ({ email: u.email, name: u.name, kind: "interviewer" }))];
  const role = stage.kit.application.role.title;

  let ev: GEvent | null = null;
  let organizerEmail: string | null = null;
  if (live) {
    if (c.isSample) return { error: "This is a fictional sample person. Live calendar events can't be created for sample candidates." };
    const conn = await db.calendarConnection.findUnique({ where: { userId_orgId: { userId: auth.userId, orgId: auth.orgId } } });
    if (conn?.status !== "connected") return { error: "Connect your Google Calendar first — the event is created on your calendar." };
    organizerEmail = conn.googleEmail;
    // Unknown availability is never assumed free: it must be acknowledged explicitly.
    const connected = new Set((await db.calendarConnection.findMany({ where: { orgId: auth.orgId, userId: { in: ids }, status: "connected" }, select: { userId: true } })).map((x) => x.userId));
    const manual = JSON.parse(s.manualWindowsJson) as Record<string, Window[]>;
    const unknown = users.filter((u) => !connected.has(u.id) && !(manual[u.id] ?? []).some((w) => Date.parse(w.start) <= start && Date.parse(w.end) >= end));
    if (unknown.length && !input.acceptUnknown) return { error: `Availability is unknown for ${unknown.map((u) => u.name).join(", ")}. Confirm you've checked with them, then schedule.` };
    try {
      const conflicts = await recheck(auth, ids, start, end);
      if (conflicts.length) return { error: `${conflicts.join(", ")} now ${conflicts.length === 1 ? "has" : "have"} a conflict at this time. Find slots again and pick another time.` };
      ev = await createEvent(auth.orgId, auth.userId, {
        requestKey: input.requestKey,
        summary: `Interview: ${c.fullName} — ${role} (${stage.name})`,
        description: `${stage.name} for the ${role} role.${stage.purpose ? `\n${stage.purpose}` : ""}\n\nScheduled with Talyn.`,
        start: new Date(start),
        end: new Date(end),
        timeZone: s.timeZone,
        attendees: attendees.map((a) => ({ email: a.email, displayName: a.name })),
        withMeet: s.meetingMethod === "meet",
        location: s.meetingMethod === "meet" ? null : s.locationNote,
      });
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }
  const meet = ev ? (s.meetingMethod === "meet" ? meetFrom(ev) : { url: null, status: "not_requested" as const }) : { url: null, status: s.meetingMethod === "meet" ? ("unavailable" as const) : ("not_requested" as const) };
  await db.$transaction([
    db.interviewEvent.create({
      data: {
        orgId: auth.orgId,
        kitId: stage.kitId,
        stageId,
        requestKey: input.requestKey,
        mode: live ? "live" : "demo",
        organizerUserId: auth.userId,
        organizerEmail,
        googleEventId: ev?.id ?? null,
        status: "scheduled",
        startAt: new Date(start),
        endAt: new Date(end),
        timeZone: s.timeZone,
        attendeesJson: JSON.stringify(attendees.map((a) => ({ ...a, responseStatus: ev?.attendees?.find((x) => x.email.toLowerCase() === a.email.toLowerCase())?.responseStatus ?? null }))),
        meetUrl: meet.url,
        meetStatus: meet.status,
        htmlLink: ev?.htmlLink ?? null,
        meetingMethod: s.meetingMethod,
        locationNote: s.locationNote,
        createdByName: auth.userName,
        lastSyncedAt: ev ? new Date() : null,
      },
    }),
    db.interviewStage.update({ where: { id: stageId }, data: { scheduledAt: new Date(start), durationMins: s.durationMins, locationNote: meet.url ? "Google Meet (link in the calendar invite)" : (s.locationNote ?? METHOD_LABEL[s.meetingMethod]) } }),
  ]);
  await audit(auth, "schedule.created", { subjectType: "application", subjectId: stage.kitId, candidateId: c.id, meta: { mode: live ? "live" : "demo", meet: meet.status } });
  refresh(stage.kitId, stageId);
  return {
    ok: true,
    message: live
      ? `Google Calendar created the event and sent invitations to ${attendees.length} attendees.${meet.status === "created" ? " A Meet link was added." : meet.status === "pending" ? " The Meet link is still being created — refresh in a moment." : meet.status === "unavailable" ? " Google didn't add a Meet link for this calendar." : ""}`
      : "Demo: a simulated event was saved in Talyn. No calendar event was created and no invitations were sent.",
  };
}

