import "server-only";
import { db } from "../db";
import { CalendarError, calendarConfigured, errorMessage, freeBusy } from "./google";
import { demoBusy } from "./demo";
import type { Availability, Busy, Window } from "./time";

export type InterviewerStatus = {
  id: string;
  name: string;
  email: string;
  source: "own_calendar" | "shared_calendar" | "manual" | "demo" | "unknown";
  detail: string;
};

const toBusy = (w: Window[]): Busy[] => w.map((x) => ({ start: Date.parse(x.start), end: Date.parse(x.end) })).filter((b) => b.end > b.start);

/**
 * Availability per interviewer, from the most to least authoritative:
 * 1. their own authorized calendar (free/busy only);
 * 2. a calendar they shared with the scheduler (queried with the scheduler's authorization);
 * 3. windows the recruiter entered by hand;
 * otherwise "unknown" — never treated as free. In demo mode everyone gets fictional busy blocks.
 */
export async function interviewerAvailability(input: {
  orgId: string;
  schedulerId: string;
  interviewers: { id: string; name: string; email: string }[];
  manual: Record<string, Window[]>;
  dates: string[];
  timeZone: string;
  timeMin: Date;
  timeMax: Date;
}): Promise<{ demo: boolean; list: (InterviewerStatus & { availability: Availability })[] }> {
  if (!calendarConfigured()) {
    return {
      demo: true,
      list: input.interviewers.map((iv) =>
        input.manual[iv.id]?.length
          ? { ...iv, source: "manual" as const, detail: "Entered by recruiter", availability: { kind: "manual" as const, free: toBusy(input.manual[iv.id]) } }
          : { ...iv, source: "demo" as const, detail: "Sample availability (demo) — not a real calendar", availability: { kind: "calendar" as const, busy: demoBusy(iv.id, input.dates, input.timeZone) } },
      ),
    };
  }
  const conns = await db.calendarConnection.findMany({ where: { orgId: input.orgId, userId: { in: [...input.interviewers.map((i) => i.id), input.schedulerId] } } });
  const byUser = new Map(conns.map((c) => [c.userId, c]));
  const scheduler = byUser.get(input.schedulerId);
  const list: (InterviewerStatus & { availability: Availability })[] = [];
  const needShared: typeof input.interviewers = [];

  for (const iv of input.interviewers) {
    const c = byUser.get(iv.id);
    if (c?.status === "connected") {
      try {
        const r = await freeBusy(input.orgId, iv.id, ["primary"], input.timeMin, input.timeMax);
        const p = r.primary;
        if (p.ok) {
          list.push({ ...iv, source: "own_calendar", detail: `Google Calendar (${c.googleEmail}) · free/busy checked now`, availability: { kind: "calendar", busy: p.busy } });
          continue;
        }
      } catch (err) {
        if (!(err instanceof CalendarError)) throw err;
        if (!input.manual[iv.id]?.length) {
          list.push({ ...iv, source: "unknown", detail: errorMessage(err), availability: { kind: "unknown", reason: errorMessage(err) } });
          continue;
        }
      }
    }
    if (input.manual[iv.id]?.length) {
      list.push({ ...iv, source: "manual", detail: "Entered by recruiter", availability: { kind: "manual", free: toBusy(input.manual[iv.id]) } });
      continue;
    }
    needShared.push(iv);
  }

  // Calendars shared with the scheduler: Google answers only if the owner made free/busy visible.
  if (needShared.length && scheduler?.status === "connected") {
    try {
      const r = await freeBusy(input.orgId, input.schedulerId, needShared.map((i) => i.email), input.timeMin, input.timeMax);
      for (const iv of needShared) {
        const p = r[iv.email];
        list.push(
          p?.ok
            ? { ...iv, source: "shared_calendar", detail: "Calendar shared with you · free/busy checked now", availability: { kind: "calendar", busy: p.busy } }
            : { ...iv, source: "unknown", detail: "Calendar not connected or shared — availability unknown", availability: { kind: "unknown", reason: "not shared" } },
        );
      }
    } catch (err) {
      if (!(err instanceof CalendarError)) throw err;
      for (const iv of needShared) list.push({ ...iv, source: "unknown", detail: `Couldn't check: ${errorMessage(err)}`, availability: { kind: "unknown", reason: errorMessage(err) } });
    }
  } else {
    for (const iv of needShared) list.push({ ...iv, source: "unknown", detail: "Calendar not connected — availability unknown", availability: { kind: "unknown", reason: "not connected" } });
  }
  const order = new Map(input.interviewers.map((iv, i) => [iv.id, i]));
  return { demo: false, list: list.sort((a, b) => order.get(a.id)! - order.get(b.id)!) };
}
