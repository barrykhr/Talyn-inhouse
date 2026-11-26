"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { interviewerAvailability } from "@/lib/calendar/availability";
import { CalendarError, calendarConfigured, cancelEvent, createEvent, disconnect, errorMessage, freeBusy, getEvent, meetFrom, patchEvent, type GEvent } from "@/lib/calendar/google";
import { dateRange, findSlots, formatInZone, isValidTimeZone, overlaps, zonedToUtc, type Window } from "@/lib/calendar/time";
import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import { getEmailProvider } from "@/lib/outreach/provider";
import { sendWhatsAppTemplate, waNumber, whatsappConfigured, whatsappTemplate } from "@/lib/outreach/whatsapp";
import { str, type ActionState } from "./form";
import { ensureScheduling } from "./scheduling-store";
import { bookInterview, recheck, type ScheduleInput } from "./scheduling-book";
import { appUrl } from "@/lib/integrations/env";
import { bookingLine } from "@/lib/loop/messages";
import { newLinkToken } from "@/lib/loop/token";

const METHOD_LABEL: Record<string, string> = { meet: "Google Meet", phone: "Phone", in_person: "In person", other: "Other" };

const refresh = (kitId: string, stageId: string) => {
  revalidatePath(`/interviews/${kitId}`);
  revalidatePath(`/interviews/${kitId}/schedule/${stageId}`);
  revalidatePath("/interviews");
};

/** Who may change a scheduled interview: its organizer, the plan owner, the plan's hiring manager, or an admin. */
function canManage(auth: AuthContext, kit: { ownerId: string; hiringManagerId: string | null }, ev?: { organizerUserId: string }) {
  return auth.membershipRole === "admin" || auth.membershipRole === "hiring_manager" || kit.ownerId === auth.userId || kit.hiringManagerId === auth.userId || ev?.organizerUserId === auth.userId;
}

/** Step 1: interviewers, duration, date range, working hours, time zone, candidate contact, meeting method. */
export async function saveSchedulingSetup(stageId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const stage = await ensureScheduling(auth, stageId);
  if (!stage) return { error: "Stage not found." };
  const assigned = new Set(stage.assignments.map((a) => a.interviewerId));
  const ids = fd.getAll("interviewer").map(String).filter((x) => assigned.has(x));
  if (!ids.length) return { error: "Choose at least one interviewer (assign interviewers to the stage first)." };
  const tz = str(fd, "timeZone", 60);
  if (!isValidTimeZone(tz)) return { error: "Choose a valid time zone." };
  const from = str(fd, "dateFrom", 10);
  const to = str(fd, "dateTo", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from) || !/^\d{4}-\d{2}-\d{2}$/.test(to) || to < from) return { error: "Check the date range." };
  if (dateRange(from, to, 100).length > 21) return { error: "Choose a range of three weeks or less." };
  const ws = str(fd, "workStart", 5);
  const we = str(fd, "workEnd", 5);
  if (!/^\d{2}:\d{2}$/.test(ws) || !/^\d{2}:\d{2}$/.test(we) || we <= ws) return { error: "Check the working hours." };
  const dur = Number(str(fd, "durationMins", 4));
  if (!Number.isInteger(dur) || dur < 15 || dur > 480) return { error: "Duration must be 15–480 minutes." };
  const email = str(fd, "candidateEmail", 200).toLowerCase();
  if (email && !z.string().email().safeParse(email).success) return { error: "Check the candidate's email address." };
  const method = str(fd, "meetingMethod", 20);
  await db.interviewScheduling.update({
    where: { stageId },
    data: {
      interviewerIdsJson: JSON.stringify(ids),
      durationMins: dur,
      dateFrom: from,
      dateTo: to,
      workStart: ws,
      workEnd: we,
      timeZone: tz,
      candidateEmail: email || null,
      candidatePhone: str(fd, "candidatePhone", 40) || null,
      meetingMethod: METHOD_LABEL[method] ? method : "meet",
      locationNote: str(fd, "locationNote", 300) || null,
      updatedByName: auth.userName,
    },
  });
  refresh(stage.kitId, stageId);
  return { ok: true, message: "Saved" };
}

/** Availability someone told the recruiter (candidate or an interviewer without a connected calendar). */
export async function saveWindows(stageId: string, who: string, windows: { date: string; start: string; end: string }[]): Promise<ActionState> {
  const auth = await requireAuth();
  const stage = await ensureScheduling(auth, stageId);
  if (!stage?.scheduling) return { error: "Stage not found." };
  const tz = stage.scheduling.timeZone;
  const parsed: Window[] = [];
  for (const w of windows.slice(0, 30)) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(w.date) || !/^\d{2}:\d{2}$/.test(w.start) || !/^\d{2}:\d{2}$/.test(w.end) || w.end <= w.start) return { error: "Each window needs a date and a start before its end." };
    parsed.push({ start: new Date(zonedToUtc(w.date, w.start, tz)).toISOString(), end: new Date(zonedToUtc(w.date, w.end, tz)).toISOString() });
  }
  if (who === "candidate") {
    await db.interviewScheduling.update({ where: { stageId }, data: { candidateWindowsJson: JSON.stringify(parsed), updatedByName: auth.userName } });
  } else {
    if (!stage.assignments.some((a) => a.interviewerId === who)) return { error: "Unknown interviewer." };
    const manual = JSON.parse(stage.scheduling.manualWindowsJson) as Record<string, Window[]>;
    if (parsed.length) manual[who] = parsed;
    else delete manual[who];
    await db.interviewScheduling.update({ where: { stageId }, data: { manualWindowsJson: JSON.stringify(manual), updatedByName: auth.userName } });
  }
  refresh(stage.kitId, stageId);
  return { ok: true, message: "Availability saved" };
}

export type SlotResult = {
  ok?: boolean;
  error?: string;
  demo: boolean;
  timeZone: string;
  statuses: { id: string; name: string; source: string; detail: string }[];
  available: { start: number; end: number; unknownFor: string[] }[];
  partial: { start: number; end: number; unknownFor: string[] }[];
  checkedAt: string;
};

/** Step 3: free/busy for authorized calendars (or demo), merged with manual windows, into slots. */
export async function findSlotsAction(stageId: string): Promise<SlotResult> {
  const auth = await requireAuth();
  const stage = await ensureScheduling(auth, stageId);
  const empty = { demo: !calendarConfigured(), timeZone: "UTC", statuses: [], available: [], partial: [], checkedAt: new Date().toISOString() };
  if (!stage?.scheduling) return { ...empty, error: "Stage not found." };
  const s = stage.scheduling;
  const ids = JSON.parse(s.interviewerIdsJson) as string[];
  if (!ids.length) return { ...empty, error: "Choose interviewers first." };
  const users = await db.user.findMany({ where: { id: { in: ids }, memberships: { some: { orgId: auth.orgId } } }, select: { id: true, name: true, email: true } });
  const dates = dateRange(s.dateFrom, s.dateTo);
  const timeMin = new Date(zonedToUtc(dates[0], "00:00", s.timeZone));
  const timeMax = new Date(zonedToUtc(dates[dates.length - 1], "23:59", s.timeZone));
  try {
    const av = await interviewerAvailability({ orgId: auth.orgId, schedulerId: auth.userId, interviewers: users, manual: JSON.parse(s.manualWindowsJson), dates, timeZone: s.timeZone, timeMin, timeMax });
    const r = findSlots({
      dates,
      workStart: s.workStart,
      workEnd: s.workEnd,
      timeZone: s.timeZone,
      durationMins: s.durationMins,
      interviewers: av.list.map((x) => ({ id: x.id, name: x.name, availability: x.availability })),
      candidateWindows: (JSON.parse(s.candidateWindowsJson) as Window[]).map((w) => ({ start: Date.parse(w.start), end: Date.parse(w.end) })),
      notBefore: Date.now() + 60 * 60000,
    });
    return { ok: true, demo: av.demo, timeZone: s.timeZone, statuses: av.list.map(({ id, name, source, detail }) => ({ id, name, source, detail })), ...r, checkedAt: new Date().toISOString() };
  } catch (err) {
    logError("schedule.find_failed", err);
    return { ...empty, timeZone: s.timeZone, error: errorMessage(err) };
  }
}

function proposalText(input: { candidateName: string; roleTitle: string; stageName: string; company: string; sender: string; slots: number[]; durationMins: number; timeZone: string; bookingUrl?: string }) {
  const first = input.candidateName.split(/\s+/)[0];
  const lines = input.slots.map((t) => `• ${formatInZone(t, input.timeZone, { weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit" })} (${input.timeZone})`);
  return `Hi ${first},\n\nThanks for your time so far. For the ${input.stageName} for the ${input.roleTitle} role at ${input.company}, would any of these ${input.durationMins}-minute times work for you?\n\n${lines.join("\n")}${input.bookingUrl ? `\n\n${bookingLine(input.bookingUrl)}` : ""}\n\nIf none suit, just reply with a few times that do.\n\nBest,\n${input.sender}`;
}

/** Preview of the proposal text. No side effects: nothing is recorded or sent. */
export async function previewProposal(stageId: string, starts: number[]): Promise<{ text?: string; error?: string }> {
  const auth = await requireAuth();
  const stage = await ensureScheduling(auth, stageId);
  if (!stage?.scheduling) return { error: "Stage not found." };
  const slots = starts.filter((t) => Number.isFinite(t) && t > Date.now()).slice(0, 5);
  if (!slots.length) return { error: "Choose at least one future time." };
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { name: true } });
  const s = stage.scheduling;
  return { text: proposalText({ candidateName: stage.kit.application.candidate.fullName, roleTitle: stage.kit.application.role.title, stageName: stage.name, company: org.name, sender: auth.userName, slots, durationMins: s.durationMins, timeZone: s.timeZone }) };
}

/**
 * Proposes times to the candidate — only after the recruiter reviews them. Email/WhatsApp go
 * through the existing authorized providers; otherwise the recruiter copies the text and it's
 * recorded as sent manually by them. Nothing is claimed as sent without provider confirmation.
 */
export async function proposeTimes(stageId: string, starts: number[], channel: "email" | "whatsapp" | "manual"): Promise<ActionState & { text?: string }> {
  const auth = await requireAuth();
  const stage = await ensureScheduling(auth, stageId);
  if (!stage?.scheduling) return { error: "Stage not found." };
  const s = stage.scheduling;
  const c = stage.kit.application.candidate;
  const slots = starts.filter((t) => Number.isFinite(t) && t > Date.now()).slice(0, 5);
  if (!slots.length) return { error: "Choose at least one time to propose." };
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { name: true } });
  // A single-use link lets the candidate pick one of these times; it's booked on the proposer's calendar.
  const booking = newLinkToken("bk");
  const text = proposalText({ candidateName: c.fullName, roleTitle: stage.kit.application.role.title, stageName: stage.name, company: org.name, sender: auth.userName, slots, durationMins: s.durationMins, timeZone: s.timeZone, bookingUrl: `${appUrl()}/book/${booking.token}` });
  if (c.isSample) return { error: "This is a fictional sample person — there is no one to contact.", text };
  if (c.contactOptOut && channel !== "manual") return { error: "The candidate opted out of contact.", text };
  let via = channel;
  if (channel === "email") {
    const provider = getEmailProvider();
    if (!provider) return { error: "Email sending isn't connected. Copy the text and send it yourself.", text };
    if (!s.candidateEmail) return { error: "Add the candidate's email address first.", text };
    try {
      await provider.send({ to: s.candidateEmail, from: process.env.OUTREACH_FROM_EMAIL!, replyTo: process.env.OUTREACH_REPLY_TO || undefined, subject: `Interview times — ${stage.kit.application.role.title} at ${org.name}`, text });
    } catch (err) {
      logError("schedule.propose_email_failed", err);
      return { error: "The mail server didn't accept the message. Nothing was sent.", text };
    }
  } else if (channel === "whatsapp") {
    if (!whatsappConfigured()) return { error: "WhatsApp isn't connected.", text };
    if (c.whatsappPermission !== "granted") return { error: "No WhatsApp opt-in is recorded for this candidate.", text };
    if (!whatsappTemplate().params.includes("message")) return { error: "Your approved WhatsApp template has no free-text field, so it can't carry proposed times. Use email or copy the text.", text };
    const to = waNumber(s.candidatePhone ?? c.phone);
    if (!to) return { error: "Add a phone number with a country code.", text };
    try {
      await sendWhatsAppTemplate(to, { first_name: c.fullName.split(/\s+/)[0], role_title: stage.kit.application.role.title, company: org.name, recruiter_name: auth.userName, message: text });
    } catch (err) {
      logError("schedule.propose_whatsapp_failed", err);
      return { error: "WhatsApp didn't accept the message. Nothing was sent.", text };
    }
  } else via = "manual";
  await db.interviewScheduling.update({
    where: { stageId },
    data: { proposedSlotsJson: JSON.stringify(slots), proposedVia: via, proposedAt: new Date(), proposedById: auth.userId, bookingTokenHash: booking.hash, bookingExpiresAt: new Date(Math.max(...slots)), updatedByName: auth.userName },
  });
  await audit(auth, "schedule.times_proposed", { subjectType: "application", subjectId: stage.kitId, candidateId: c.id, meta: { via, count: slots.length } });
  refresh(stage.kitId, stageId);
  return { ok: true, text, message: via === "manual" ? "Recorded as proposed — send the copied text yourself." : via === "email" ? "Sent by email (accepted by the mail server)." : "Sent on WhatsApp (accepted by WhatsApp)." };
}

export type { ScheduleInput } from "./scheduling-book";

/**
 * Creates the interview — only on the recruiter's explicit confirmation. See bookInterview.
 */
export async function scheduleInterview(stageId: string, input: ScheduleInput): Promise<ActionState> {
  const auth = await requireAuth();
  return bookInterview(auth, stageId, input);
}

async function loadEvent(auth: AuthContext, eventId: string) {
  return db.interviewEvent.findFirst({ where: { id: eventId, orgId: auth.orgId }, include: { stage: { include: { kit: true } } } });
}

/** Moves the event to a new time (Google sends updated invitations). Organizer only for live events. */
export async function rescheduleInterview(eventId: string, start: number): Promise<ActionState> {
  const auth = await requireAuth();
  const ev = await loadEvent(auth, eventId);
  if (!ev || ev.status !== "scheduled") return { error: "Scheduled interview not found." };
  if (!canManage(auth, ev.stage.kit, ev)) return { error: "Only the organizer, the plan owner, a hiring manager or an admin can reschedule." };
  if (ev.mode === "live" && ev.organizerUserId !== auth.userId) return { error: "The event is on the organizer's Google Calendar — ask them to reschedule it from Talyn." };
  const dur = ev.endAt.getTime() - ev.startAt.getTime();
  if (!Number.isFinite(start) || start < Date.now()) return { error: "Choose a time in the future." };
  const end = start + dur;
  let synced: GEvent | null = null;
  if (ev.mode === "live" && ev.googleEventId) {
    try {
      const sched = await db.interviewScheduling.findUnique({ where: { stageId: ev.stageId } });
      const ids = JSON.parse(sched?.interviewerIdsJson ?? "[]") as string[];
      const conflicts = await recheck(auth, ids, start, end, { start: ev.startAt.getTime(), end: ev.endAt.getTime() });
      if (conflicts.length) return { error: `${conflicts.join(", ")} ${conflicts.length === 1 ? "has" : "have"} a conflict at that time. Pick another time.` };
      synced = await patchEvent(auth.orgId, auth.userId, ev.googleEventId, { start: new Date(start), end: new Date(end), timeZone: ev.timeZone });
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }
  await db.$transaction([
    db.interviewEvent.update({ where: { id: eventId }, data: { startAt: new Date(start), endAt: new Date(end), updatedByName: auth.userName, lastSyncedAt: synced ? new Date() : ev.lastSyncedAt, htmlLink: synced?.htmlLink ?? ev.htmlLink } }),
    db.interviewStage.update({ where: { id: ev.stageId }, data: { scheduledAt: new Date(start) } }),
  ]);
  await audit(auth, "schedule.rescheduled", { subjectType: "application", subjectId: ev.kitId, meta: { mode: ev.mode } });
  refresh(ev.kitId, ev.stageId);
  return { ok: true, message: ev.mode === "live" ? "Rescheduled in Google Calendar; Google sent updated invitations." : "Demo: the simulated event was moved. Nothing was sent." };
}

export async function cancelInterview(eventId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const ev = await loadEvent(auth, eventId);
  if (!ev || ev.status !== "scheduled") return { error: "Scheduled interview not found." };
  if (!canManage(auth, ev.stage.kit, ev)) return { error: "Only the organizer, the plan owner, a hiring manager or an admin can cancel." };
  if (ev.mode === "live" && ev.organizerUserId !== auth.userId) return { error: "The event is on the organizer's Google Calendar — ask them to cancel it from Talyn." };
  if (ev.mode === "live" && ev.googleEventId) {
    try {
      await cancelEvent(auth.orgId, auth.userId, ev.googleEventId);
    } catch (err) {
      return { error: errorMessage(err) };
    }
  }
  await db.$transaction([
    db.interviewEvent.update({ where: { id: eventId }, data: { status: "cancelled", updatedByName: auth.userName } }),
    db.interviewStage.update({ where: { id: ev.stageId }, data: { scheduledAt: null } }),
  ]);
  await audit(auth, "schedule.cancelled", { subjectType: "application", subjectId: ev.kitId, meta: { mode: ev.mode } });
  refresh(ev.kitId, ev.stageId);
  return { ok: true, message: ev.mode === "live" ? "Cancelled in Google Calendar; Google notified the attendees." : "Demo: the simulated event was cancelled. Nothing was sent." };
}

/** Pulls the event's current state from Google (status, Meet link, attendee responses). */
export async function refreshInterviewEvent(eventId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const ev = await loadEvent(auth, eventId);
  if (!ev) return { error: "Not found." };
  if (ev.mode !== "live" || !ev.googleEventId) return { ok: true, message: "Demo event — nothing to sync." };
  if (ev.organizerUserId !== auth.userId) return { error: "Only the organizer's connection can read this event." };
  try {
    const g = await getEvent(auth.orgId, auth.userId, ev.googleEventId);
    const meet = ev.meetingMethod === "meet" ? meetFrom(g) : { url: null, status: "not_requested" as const };
    const attendees = (JSON.parse(ev.attendeesJson) as { email: string; name: string; kind: string; responseStatus?: string | null }[]).map((a) => ({ ...a, responseStatus: g.attendees?.find((x) => x.email.toLowerCase() === a.email.toLowerCase())?.responseStatus ?? a.responseStatus ?? null }));
    await db.interviewEvent.update({
      where: { id: eventId },
      data: { status: g.status === "cancelled" ? "cancelled" : ev.status, meetUrl: meet.url ?? ev.meetUrl, meetStatus: meet.url ? "created" : meet.status, htmlLink: g.htmlLink ?? ev.htmlLink, attendeesJson: JSON.stringify(attendees), lastSyncedAt: new Date(), lastError: null },
    });
    refresh(ev.kitId, ev.stageId);
    return { ok: true, message: g.status === "cancelled" ? "The event was cancelled in Google Calendar." : "Synced with Google Calendar." };
  } catch (err) {
    if (err instanceof CalendarError && err.kind === "not_found") {
      await db.interviewEvent.update({ where: { id: eventId }, data: { status: "cancelled", lastError: "Deleted in Google Calendar", lastSyncedAt: new Date() } });
      refresh(ev.kitId, ev.stageId);
      return { ok: true, message: "The event no longer exists in Google Calendar — marked as cancelled." };
    }
    await db.interviewEvent.update({ where: { id: eventId }, data: { lastError: errorMessage(err) } });
    return { error: errorMessage(err) };
  }
}

export async function disconnectCalendar(): Promise<ActionState> {
  const auth = await requireAuth();
  try {
    await disconnect(auth.orgId, auth.userId);
  } catch (err) {
    logError("calendar.disconnect_failed", err);
    return { error: "Couldn't disconnect. Try again." };
  }
  await audit(auth, "calendar.disconnected", { subjectType: "org", subjectId: auth.orgId });
  revalidatePath("/integrations");
  return { ok: true, message: "Disconnected. Talyn deleted your Google tokens and asked Google to revoke access." };
}
