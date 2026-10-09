import Link from "next/link";
import { notFound } from "next/navigation";
import { CALENDAR_RESULT } from "@/components/calendar/connection";
import { Notice } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { calendarConfigured } from "@/lib/calendar/google";
import { localParts, type Window } from "@/lib/calendar/time";
import { db } from "@/lib/db";
import { loadKitForUser } from "@/lib/interviews/access";
import { getEmailProvider } from "@/lib/outreach/provider";
import { waNumber, whatsappConfigured, whatsappTemplate } from "@/lib/outreach/whatsapp";
import { ensureScheduling, eventViews } from "@/server/scheduling-store";
import { KitHeader } from "../../../kit-header";
import { Scheduler } from "./scheduler";

export const metadata = { title: "Schedule interview" };
export const maxDuration = 60;

const rows = (ws: Window[], tz: string) =>
  ws.map((w) => {
    const a = localParts(w.start, tz);
    const b = localParts(w.end, tz);
    return { date: a.date, start: a.time, end: b.time };
  });

/** Schedule one interview stage: details → availability → slots → review → Google Calendar (or demo). */
export default async function SchedulePage({ params, searchParams }: { params: Promise<{ kitId: string; stageId: string }>; searchParams: Promise<{ reschedule?: string; calendar?: string }> }) {
  const auth = await requireAuth();
  const { kitId, stageId } = await params;
  const { reschedule, calendar } = await searchParams;
  const v = await loadKitForUser(auth, kitId);
  if (!v || !v.kit.stages.some((s) => s.id === stageId)) notFound();
  const stage = await ensureScheduling(auth, stageId);
  if (!stage?.scheduling) notFound();
  const s = stage.scheduling;
  const c = stage.kit.application.candidate;
  const live = calendarConfigured();
  const assigned = stage.assignments.map((a) => a.interviewerId);
  const [conns, mine, events] = await Promise.all([
    db.calendarConnection.findMany({ where: { orgId: auth.orgId, userId: { in: assigned } }, select: { userId: true, status: true } }),
    db.calendarConnection.findUnique({ where: { userId_orgId: { userId: auth.userId, orgId: auth.orgId } }, select: { status: true } }),
    eventViews(auth, v.kit, [stageId]),
  ]);
  const manual = JSON.parse(s.manualWindowsJson) as Record<string, Window[]>;
  const returnTo = `/interviews/${kitId}/schedule/${stageId}`;
  const msg = calendar ? CALENDAR_RESULT[calendar] : null;
  const emailReady = !!getEmailProvider() && !!s.candidateEmail && !c.contactOptOut && !c.isSample;
  const waReady = whatsappConfigured() && c.whatsappPermission === "granted" && !!waNumber(s.candidatePhone ?? c.phone) && whatsappTemplate().params.includes("message") && !c.contactOptOut && !c.isSample;

  return (
    <>
      <KitHeader
        kitId={kitId}
        candidate={v.kit.application.candidate}
        role={v.kit.application.role}
        status={v.kit.status}
        active="plan"
        myScorecards={v.kit.status === "shared" ? v.mine.map((m) => ({ id: m.id, stage: v.kit.stages.find((x) => x.id === m.stageId)?.name ?? "Stage", status: m.status })) : []}
        decision={v.kit.decision}
      />
      <div className="mb-4 flex flex-wrap items-center gap-2 text-[13px]">
        <Link href={`/interviews/${kitId}`} className="text-muted underline hover:text-ink">
          ← Back to plan
        </Link>
        <span className="font-semibold">Schedule: {stage.name}</span>
        {stage.purpose && <span className="text-muted">— {stage.purpose}</span>}
      </div>
      {msg && <Notice tone={msg.tone} className="mb-4">{msg.text}</Notice>}
      <Scheduler
        stageId={stageId}
        stageName={stage.name}
        roleTitle={stage.kit.application.role.title}
        live={live}
        myConnection={mine?.status ?? null}
        connectHref={`/api/calendar/connect?returnTo=${encodeURIComponent(returnTo)}`}
        candidate={{ name: c.fullName, isSample: c.isSample, optedOut: c.contactOptOut, whatsappPermission: c.whatsappPermission }}
        setup={{
          interviewerIds: JSON.parse(s.interviewerIdsJson),
          durationMins: s.durationMins,
          dateFrom: s.dateFrom,
          dateTo: s.dateTo,
          workStart: s.workStart,
          workEnd: s.workEnd,
          timeZone: s.timeZone,
          candidateEmail: s.candidateEmail ?? "",
          candidatePhone: s.candidatePhone ?? "",
          meetingMethod: s.meetingMethod,
          locationNote: s.locationNote ?? "",
        }}
        interviewers={stage.assignments.map((a) => ({ id: a.interviewerId, name: a.interviewerName, calendar: conns.find((x) => x.userId === a.interviewerId)?.status ?? "not_connected", manual: rows(manual[a.interviewerId] ?? [], s.timeZone) }))}
        candidateWindows={rows(JSON.parse(s.candidateWindowsJson), s.timeZone)}
        proposed={{ slots: JSON.parse(s.proposedSlotsJson), via: s.proposedVia, at: s.proposedAt?.toISOString() ?? null }}
        channels={{
          email: emailReady,
          emailReason: !getEmailProvider() ? "Email sending isn't connected" : !s.candidateEmail ? "No candidate email" : c.contactOptOut ? "Candidate opted out" : c.isSample ? "Sample candidate" : "",
          whatsapp: waReady,
          whatsappReason: !whatsappConfigured()
            ? "WhatsApp isn't connected"
            : c.whatsappPermission !== "granted"
              ? "No WhatsApp opt-in recorded"
              : !whatsappTemplate().params.includes("message")
                ? "Approved template can't carry times"
                : "Needs a phone with country code",
        }}
        activeEvent={events[0]?.view ?? null}
        reschedule={!!reschedule}
      />
    </>
  );
}
