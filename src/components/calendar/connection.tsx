"use client";

import { ActionButton } from "@/components/client";
import { Badge } from "@/components/ui";
import { disconnectCalendar } from "@/server/scheduling-actions";

export type ConnectionView = { status: string; googleEmail: string; lastError: string | null; connectedAt: string } | null;

const STATE: Record<string, { label: string; tone: "ok" | "warn" | "danger" | "neutral"; text: string }> = {
  connected: { label: "Connected", tone: "ok", text: "Talyn can check your free/busy times and create, update or cancel the interview events it schedules. It never reads event details." },
  permission_required: { label: "Permission required", tone: "warn", text: "Google didn't grant both free/busy and event access. Reconnect and allow both." },
  revoked: { label: "Expired or revoked", tone: "danger", text: "Google access ended (revoked, expired, or the password changed). Reconnect to keep scheduling." },
  error: { label: "Connection error", tone: "danger", text: "Talyn couldn't refresh access. Reconnect, or try again later." },
};

/** The signed-in user's own Google Calendar connection, with connect/reconnect/disconnect. */
export function CalendarConnection({ conn, configured, returnTo }: { conn: ConnectionView; configured: boolean; returnTo: string }) {
  const href = `/api/calendar/connect?returnTo=${encodeURIComponent(returnTo)}`;
  if (!configured)
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge>Not connected</Badge>
        <span className="text-muted">Google Calendar isn&apos;t set up for this workspace yet. Scheduling runs in demo mode with sample availability.</span>
      </div>
    );
  if (!conn)
    return (
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <Badge>Not connected</Badge>
        <span className="text-muted">Connect to share your free/busy times and to create interview events on your calendar.</span>
        <a href={href} className="ml-auto inline-flex h-8 items-center rounded-lg bg-ink px-3 font-medium text-white">
          Connect Google Calendar
        </a>
      </div>
    );
  const st = STATE[conn.status] ?? STATE.error;
  return (
    <div className="space-y-1.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={st.tone}>{st.label}</Badge>
        <span className="font-medium">{conn.googleEmail || "Google account"}</span>
        <span className="text-faint">since {new Date(conn.connectedAt).toLocaleDateString()}</span>
        <span className="ml-auto flex gap-2">
          {conn.status !== "connected" && (
            <a href={href} className="inline-flex h-8 items-center rounded-lg bg-ink px-3 font-medium text-white">
              Reconnect
            </a>
          )}
          <ActionButton action={disconnectCalendar} confirm="Disconnect Google Calendar? Talyn deletes your tokens and asks Google to revoke access. Existing events stay in your calendar." successMessage="Google Calendar disconnected">
            Disconnect
          </ActionButton>
        </span>
      </div>
      <p className="text-muted">{st.text}</p>
      {conn.lastError && conn.status !== "connected" && <p className="text-[12px] text-danger">{conn.lastError}</p>}
    </div>
  );
}

export const CALENDAR_RESULT: Record<string, { tone: "ok" | "warn" | "danger"; text: string }> = {
  connected: { tone: "ok", text: "Google Calendar connected." },
  permission_required: { tone: "warn", text: "Connected, but Google didn't grant both free/busy and event access. Reconnect and allow both to schedule." },
  denied: { tone: "warn", text: "You cancelled the Google authorization. Nothing was connected." },
  state: { tone: "danger", text: "The authorization expired or didn't match. Try connecting again." },
  error: { tone: "danger", text: "Google Calendar couldn't be connected. Try again." },
  not_configured: { tone: "warn", text: "Google Calendar isn't set up for this workspace yet — an admin needs to add the Google settings." },
};
