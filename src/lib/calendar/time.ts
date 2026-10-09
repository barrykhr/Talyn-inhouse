// Time-zone math and slot finding. Pure — safe on client and server. Uses Intl only.

export type Window = { start: string; end: string }; // ISO instants
export type Busy = { start: number; end: number }; // epoch ms

/** Offset (ms) of a time zone from UTC at a given instant. */
function tzOffset(at: number, tz: string): number {
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return asUtc - at;
}

/** The UTC instant for a wall-clock time in a time zone (handles DST by iterating). */
export function zonedToUtc(date: string, time: string, tz: string): number {
  const [y, m, d] = date.split("-").map(Number);
  const [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  let t = guess - tzOffset(guess, tz);
  t = guess - tzOffset(t, tz);
  return t;
}

export function isValidTimeZone(tz: string) {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

export function formatInZone(at: number | string | Date, tz: string, opts: Intl.DateTimeFormatOptions = { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) {
  return new Intl.DateTimeFormat("en-US", { ...opts, timeZone: tz }).format(new Date(at));
}

export function dateRange(from: string, to: string, max = 21): string[] {
  const out: string[] = [];
  const d = new Date(`${from}T00:00:00Z`);
  const end = new Date(`${to}T00:00:00Z`);
  while (d <= end && out.length < max) {
    out.push(d.toISOString().slice(0, 10));
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return out;
}

export const overlaps = (a: Busy, b: Busy) => a.start < b.end && b.start < a.end;
export const within = (slot: Busy, w: Busy) => slot.start >= w.start && slot.end <= w.end;

export type Availability =
  | { kind: "calendar"; busy: Busy[] } // free/busy from an authorized calendar (live or demo)
  | { kind: "manual"; free: Busy[] } // windows entered by the recruiter
  | { kind: "unknown"; reason: string };

export type Slot = { start: number; end: number; unknownFor: string[] };

/**
 * Candidate slots in working hours on weekdays, stepping every 30 minutes. A slot is "available"
 * only when every interviewer is known to be free (calendar or manual window) and it fits the
 * candidate's windows if any were entered. Unknown availability is never treated as free: such
 * slots are returned separately with the names whose availability is unknown.
 */
export function findSlots(input: {
  dates: string[];
  workStart: string;
  workEnd: string;
  timeZone: string;
  durationMins: number;
  interviewers: { id: string; name: string; availability: Availability }[];
  candidateWindows: Busy[];
  notBefore: number;
  limit?: number;
}) {
  const available: Slot[] = [];
  const partial: Slot[] = [];
  const step = 30 * 60000;
  const dur = input.durationMins * 60000;
  for (const date of input.dates) {
    const dayStart = zonedToUtc(date, input.workStart, input.timeZone);
    const dayEnd = zonedToUtc(date, input.workEnd, input.timeZone);
    const weekday = new Intl.DateTimeFormat("en-US", { weekday: "short", timeZone: input.timeZone }).format(new Date(dayStart));
    if (weekday === "Sat" || weekday === "Sun") continue;
    for (let t = dayStart; t + dur <= dayEnd; t += step) {
      if (t < input.notBefore) continue;
      const slot = { start: t, end: t + dur };
      if (input.candidateWindows.length && !input.candidateWindows.some((w) => within(slot, w))) continue;
      let busy = false;
      const unknownFor: string[] = [];
      for (const iv of input.interviewers) {
        const a = iv.availability;
        if (a.kind === "calendar") busy ||= a.busy.some((b) => overlaps(slot, b));
        else if (a.kind === "manual") busy ||= !a.free.some((w) => within(slot, w));
        else unknownFor.push(iv.name);
      }
      if (busy) continue;
      (unknownFor.length ? partial : available).push({ ...slot, unknownFor });
    }
  }
  const limit = input.limit ?? 40;
  return { available: available.slice(0, limit), partial: partial.slice(0, limit) };
}

/** Wall-clock date ("YYYY-MM-DD") and time ("HH:MM") of an instant in a time zone. */
export function localParts(at: number | string, tz: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at));
  const g = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
  return { date: `${g("year")}-${g("month")}-${g("day")}`, time: `${g("hour")}:${g("minute")}` };
}
