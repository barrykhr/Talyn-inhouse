"use client";

import Link from "next/link";
import { ActionButton } from "@/components/client";
import { Badge } from "@/components/ui";
import { formatInZone } from "@/lib/calendar/time";
import { cancelInterview, refreshInterviewEvent } from "@/server/scheduling-actions";

export type EventView = {
  id: string;
  mode: string;
  status: string;
  startAt: string;
  endAt: string;
  timeZone: string;
  attendees: { email: string; name: string; kind: string; responseStatus?: string | null }[];
  meetUrl: string | null;
  meetStatus: string | null;
  htmlLink: string | null;
  meetingMethod: string;
  locationNote: string | null;
  organizerName: string;
  organizerEmail: string | null;
  lastSyncedAt: string | null;
  lastError: string | null;
  canManage: boolean;
  isOrganizer: boolean;
};

const RESPONSE: Record<string, string> = { accepted: "accepted", declined: "declined", tentative: "maybe", needsAction: "no response yet" };

/** A scheduled interview. Scheduling status only — never mixed with ratings or decisions. */
export function EventCard({ e, rescheduleHref }: { e: EventView; rescheduleHref?: string }) {
  const live = e.mode === "live";
  const canAct = e.canManage && (!live || e.isOrganizer);
  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface p-3 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        {live ? <Badge tone="ok">Google Calendar</Badge> : <Badge tone="warn">Demo — simulated, nothing sent</Badge>}
        <Badge tone={e.status === "scheduled" ? "ink" : "neutral"}>{e.status === "scheduled" ? "Scheduled" : e.status === "cancelled" ? "Cancelled" : e.status}</Badge>
        <span className="font-medium">
          {formatInZone(e.startAt, e.timeZone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}–{formatInZone(e.endAt, e.timeZone, { hour: "numeric", minute: "2-digit" })}
        </span>
        <span className="text-muted">{e.timeZone}</span>
      </div>
      <div className="flex flex-wrap gap-x-3 gap-y-1 text-[12.5px]">
        {e.meetingMethod === "meet" ? (
          e.meetUrl ? (
            <a href={e.meetUrl} target="_blank" rel="noopener noreferrer" className="font-medium text-inbound underline">
              Google Meet link
            </a>
          ) : (
            <span className="text-muted">{e.meetStatus === "pending" ? "Meet link being created — refresh" : live ? "No Meet link (not available for this calendar)" : "No Meet link in demo mode"}</span>
          )
        ) : (
          <span className="text-muted">{e.locationNote ?? e.meetingMethod.replace("_", " ")}</span>
        )}
        {e.htmlLink && (
          <a href={e.htmlLink} target="_blank" rel="noopener noreferrer" className="underline">
            Open in Google Calendar ↗
          </a>
        )}
        <span className="text-muted">
          Organizer: {e.organizerName}
          {e.organizerEmail ? ` (${e.organizerEmail})` : ""}
        </span>
      </div>
      <ul className="flex flex-wrap gap-x-3 gap-y-0.5 text-[12px] text-ink-2">
        {e.attendees.map((a) => (
          <li key={a.email}>
            {a.name} <span className="text-faint">· {a.kind}{live && a.responseStatus ? ` · ${RESPONSE[a.responseStatus] ?? a.responseStatus}` : ""}</span>
          </li>
        ))}
      </ul>
      {live && <p className="text-[11.5px] text-faint">{e.lastSyncedAt ? `Synced with Google ${new Date(e.lastSyncedAt).toLocaleString()}` : "Not synced yet"}{e.lastError ? ` · ${e.lastError}` : ""}</p>}
      {e.status === "scheduled" && (
        <div className="flex flex-wrap items-center gap-1.5">
          {live && e.isOrganizer && (
            <ActionButton action={() => refreshInterviewEvent(e.id)} successMessage="Synced">
              Refresh from Google
            </ActionButton>
          )}
          {canAct && rescheduleHref && (
            <Link href={rescheduleHref} className="inline-flex h-7 items-center rounded-lg border border-line-strong px-2.5 font-medium hover:bg-sunken">
              Reschedule
            </Link>
          )}
          {canAct && (
            <ActionButton
              action={() => cancelInterview(e.id)}
              variant="ghost"
              confirm={live ? "Cancel this interview? Google Calendar deletes the event and notifies all attendees." : "Cancel this simulated interview? Nothing is sent."}
              successMessage="Interview cancelled"
            >
              Cancel interview
            </ActionButton>
          )}
          {!canAct && <span className="text-[12px] text-muted">{live && !e.isOrganizer ? `Only ${e.organizerName} can change this event — it's on their calendar.` : "You can't change this interview."}</span>}
        </div>
      )}
    </div>
  );
}
