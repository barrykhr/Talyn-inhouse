import Link from "next/link";
import { Card, Notice, PageHeader, SectionTitle, formatDateTime } from "@/components/ui";
import { CALENDAR_RESULT, CalendarConnection } from "@/components/calendar/connection";
import { calendarConfigured, calendarSetup } from "@/lib/calendar/google";
import { PROVIDER_LABEL, aiStatus } from "@/lib/ai";
import { ATS_ENV, atsSetup, getAtsConnector } from "@/lib/ats/connector";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appUrl, checkEnv, type EnvCheck } from "@/lib/integrations/env";
import { emailSetup, getEmailProvider } from "@/lib/outreach/provider";
import { whatsappSetup } from "@/lib/outreach/whatsapp";
import { transcriptionConfigured, transcriptionSetup } from "@/lib/transcripts/provider";
import { CONNECTORS, SOURCING_ENV } from "@/lib/sourcing/connectors";
import { AtsButtons, EmailButtons, OutboxButtons } from "./buttons";

export const metadata = { title: "Integrations" };
export const maxDuration = 300;

function Status({ on, label }: { on: boolean; label?: string }) {
  return <span className={on ? "text-[12.5px] font-medium text-ok" : "text-[12.5px] text-faint"}>{on ? `● ${label ?? "Connected"}` : `○ ${label ?? "Not connected"}`}</span>;
}

/** Shows which variables are set — never their values. */
function EnvList({ checks }: { checks: (EnvCheck & { optional: boolean })[] }) {
  return (
    <ul className="mt-2 space-y-1 text-[12.5px]">
      {checks.map((c) => (
        <li key={c.name} className="flex gap-2">
          <span className={c.set ? "text-ok" : c.optional ? "text-faint" : "text-warn"} aria-label={c.set ? "set" : "not set"}>
            {c.set ? "✓" : "○"}
          </span>
          <span>
            <code className="font-mono text-ink">{c.name}</code>
            {c.optional && <span className="text-faint"> (optional)</span>} <span className="text-muted">— {c.purpose}</span>
          </span>
        </li>
      ))}
    </ul>
  );
}

const RUN_LABEL: Record<string, string> = { running: "Running", completed: "Completed", partial: "Completed with problems", failed: "Failed" };

export default async function IntegrationsPage({ searchParams }: { searchParams: Promise<{ calendar?: string }> }) {
  const auth = await requireAuth();
  const { calendar } = await searchParams;
  const calLive = calendarConfigured();
  const calSetup = calendarSetup();
  const calMsg = calendar ? CALENDAR_RESULT[calendar] : null;
  const myCal = await db.calendarConnection.findUnique({ where: { userId_orgId: { userId: auth.userId, orgId: auth.orgId } } });
  const teamConns = await db.calendarConnection.findMany({ where: { orgId: auth.orgId }, select: { userId: true, status: true } });
  const teamUsers = await db.user.findMany({ where: { id: { in: teamConns.map((c) => c.userId) } }, select: { id: true, name: true } });
  const teamCal = teamConns.map((c) => ({ name: teamUsers.find((u) => u.id === c.userId)?.name ?? "Member", status: c.status }));
  const isAdmin = auth.membershipRole === "admin";
  const ai = aiStatus();
  const email = emailSetup();
  const wa = whatsappSetup();
  const provider = getEmailProvider();
  const ats = atsSetup();
  const atsConn = getAtsConnector();
  const cron = checkEnv([{ name: "CRON_SECRET", secret: true, purpose: "Authorizes the scheduled jobs (retention, sending, ATS sync)" }]);
  const [org, otherLinked, due, sendFailures, runs, conflicts, failedPushes] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { atsLinkedAt: true, atsLinkedBy: true } }),
    db.organization.count({ where: { atsLinkedAt: { not: null }, id: { not: auth.orgId } } }),
    db.outreachMessage.count({ where: { orgId: auth.orgId, status: "approved", sentAt: null, dueAt: { lte: new Date() }, sequence: { status: "active" } } }),
    db.outreachEvent.count({ where: { orgId: auth.orgId, type: "send_failed", createdAt: { gte: new Date(Date.now() - 7 * 86400000) } } }),
    db.atsSyncRun.findMany({ where: { orgId: auth.orgId }, orderBy: { startedAt: "desc" }, take: 10 }),
    db.atsConflict.count({ where: { orgId: auth.orgId, status: "open" } }),
    db.atsOutbox.findMany({ where: { orgId: auth.orgId, status: "failed" }, orderBy: { createdAt: "asc" }, take: 20 }),
  ]);
  const base = appUrl();

  return (
    <div className="max-w-3xl space-y-5">
      <PageHeader title="Integrations" />
      <p className="-mt-2 text-[13px] text-muted">
        Each integration is built in and stays off until its credentials are added as environment variables (in Vercel: Project → Settings → Environment Variables, then redeploy). Nothing here is
        sent anywhere unless it says Connected. Secret values are never shown.
      </p>

      <Card className="p-5">
        <SectionTitle>
          AI provider <Status on={ai.configured} />
        </SectionTitle>
        <p className="text-[13px] text-muted">
          {ai.configured && ai.provider
            ? `${PROVIDER_LABEL[ai.provider]} · ${ai.model}. Receives role/criteria text, CV text with email and phone redacted, and confirmed profile facts for drafting outreach.`
            : "Not configured — AI features are off; labeled non-AI helpers are used."}
        </p>
      </Card>

      <Card className="p-5">
        <SectionTitle hint="Vendor-neutral SMTP: Google Workspace, Microsoft 365, Amazon SES, SendGrid, Postmark, Mailgun and most mail services.">
          Email sending <Status on={!!provider} />
        </SectionTitle>
        <div className="space-y-2 text-[13px] text-ink-2">
          {provider ? (
            <p>
              Talyn sends only recruiter-approved messages in sequences a recruiter activated, once a day (or with <strong>Send due messages now</strong>). Every message carries an unsubscribe link;
              replies go to {process.env.OUTREACH_REPLY_TO ? "the reply-to address" : "the sender address"}. {due} message{due === 1 ? " is" : "s are"} due now.
              {sendFailures > 0 && <span className="text-danger"> {sendFailures} send failure(s) in the last 7 days — they retry on the next run.</span>}
            </p>
          ) : (
            <p>Off. Recruiters send approved messages from their own mail client and record them as sent. Add these variables to turn sending on:</p>
          )}
          <EnvList checks={email.checks} />
          <details className="text-[12.5px]">
            <summary className="cursor-pointer text-muted">Delivery, bounce and reply events</summary>
            <p className="mt-1 text-muted">
              SMTP only tells Talyn a message was accepted. To mark delivered / bounced / replied / opted-out automatically, have your mail service (or a small relay) POST events to{" "}
              <code className="font-mono">{base}/api/webhooks/email</code> with <code className="font-mono">Authorization: Bearer $EMAIL_WEBHOOK_SECRET</code>. See docs/INTEGRATIONS.md. Without it,
              recruiters record these outcomes, and they&apos;re labeled as recruiter-recorded.
            </p>
          </details>
          {(provider || wa.ready) && isAdmin && <EmailButtons />}
        </div>
      </Card>

      <Card className="p-5" id="calendar">
        <SectionTitle hint="Free/busy lookups and interview events only. Each person connects their own calendar.">
          Google Calendar <Status on={calLive} label={calLive ? "Available" : "Not connected · demo mode"} />
        </SectionTitle>
        <div className="space-y-3 text-[13px] text-ink-2">
          {calMsg && <Notice tone={calMsg.tone}>{calMsg.text}</Notice>}
          <div className="rounded-lg border border-line p-3">
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Your calendar</div>
            <CalendarConnection
              configured={calLive}
              returnTo="/integrations#calendar"
              conn={myCal ? { status: myCal.status, googleEmail: myCal.googleEmail, lastError: myCal.lastError, connectedAt: myCal.connectedAt.toISOString() } : null}
            />
          </div>
          {calLive && teamCal.length > 0 && (
            <p className="text-[12.5px] text-muted">
              Connected in this workspace: {teamCal.map((c) => `${c.name} (${c.status === "connected" ? "connected" : c.status.replace("_", " ")})`).join(", ")}
            </p>
          )}
          <p>
            Scopes requested only when someone clicks Connect: <code className="font-mono text-[12px]">calendar.freebusy</code> (busy/free times, no event details) and{" "}
            <code className="font-mono text-[12px]">calendar.events.owned</code> (create, change and cancel the interview events Talyn schedules), plus <code className="font-mono text-[12px]">openid email</code> to show which
            account is connected. No Gmail, Drive or Contacts access. Tokens are encrypted and kept server-side.
          </p>
          <EnvList checks={calSetup.checks} />
          <p className="text-[12.5px] text-muted">
            Authorized redirect URI to add to your Google OAuth client: <code className="font-mono">{base}/api/calendar/callback</code>. See docs/INTEGRATIONS.md for the Google Cloud steps.
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle hint="WhatsApp Business Platform (Cloud API). Business-initiated messages use your approved template.">
          WhatsApp <Status on={wa.ready} />
        </SectionTitle>
        <div className="space-y-2 text-[13px] text-ink-2">
          <p>
            {wa.ready
              ? `Talyn sends the approved template “${process.env.WHATSAPP_TEMPLATE_NAME}” only for sequences a recruiter approved and activated, and only to candidates with a recorded WhatsApp opt-in and a phone number with country code.`
              : "Off. WhatsApp drafts can be prepared, but sending stays disabled. To connect, create an approved message template in your WhatsApp Business account and add:"}
          </p>
          <EnvList checks={wa.checks} />
          <details className="text-[12.5px]">
            <summary className="cursor-pointer text-muted">Replies and delivery status</summary>
            <p className="mt-1 text-muted">
              In your Meta app, set the webhook URL to <code className="font-mono">{base}/api/webhooks/whatsapp</code> with <code className="font-mono">WHATSAPP_VERIFY_TOKEN</code>, and subscribe to{" "}
              <code className="font-mono">messages</code>. Requests are verified with <code className="font-mono">WHATSAPP_APP_SECRET</code>. A reply stops follow-ups automatically; delivery is
              marked provider-confirmed.
            </p>
          </details>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle hint="Turns an uploaded interview recording into a timestamped transcript. Talyn never joins or records meetings.">
          Interview transcription <Status on={transcriptionConfigured()} />
        </SectionTitle>
        <div className="space-y-2 text-[13px] text-ink-2">
          <p>
            {transcriptionConfigured()
              ? "On. When an interviewer uploads a recording (after confirming your consent process), Talyn sends the audio to OpenAI for transcription, stores only the timestamped text and discards the audio."
              : "Off. Interviewers can still import the transcript their meeting tool produces (VTT, SRT or timestamped text) once an admin turns on recording & transcription in Workspace settings. To transcribe uploaded recordings, add:"}
          </p>
          <EnvList checks={transcriptionSetup().checks} />
          <p className="text-[12.5px] text-muted">
            Set <code className="font-mono">TRANSCRIPTION_ENABLED=true</code> only once your recording and consent policy allows sending interview audio to the provider. Uploads are limited to 24 MB; your hosting plan&apos;s request
            size limit may be lower, in which case use transcript import. whisper-1 doesn&apos;t identify speakers — reviewers assign them in Talyn.
          </p>
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle hint="Authorized data only. Talyn never scrapes websites or automates logins.">Sourcing</SectionTitle>
        <ul className="space-y-3 text-[13px]">
          {CONNECTORS.map((c) => (
            <li key={c.key}>
              <div className="font-medium">
                {c.label} <Status on={c.configured()} />
              </div>
              <p className="text-muted">{c.configured() ? c.description : c.setupHint}</p>
              {c.key === "external" && <EnvList checks={checkEnv(SOURCING_ENV).checks} />}
            </li>
          ))}
          <li>
            <div className="font-medium">
              Authorized export import <Status on label="Available" />
            </div>
            <p className="text-muted">On a role&apos;s Discover tab, import a CSV exported from a source your organization is licensed to use. The recruiter names the source and confirms the licence.</p>
          </li>
        </ul>
      </Card>

      <Card className="p-5">
        <SectionTitle hint="Field ownership, duplicates, conflicts and failures follow docs/ATS_INTEGRATION.md.">
          ATS <Status on={!!atsConn && !!org.atsLinkedAt} label={atsConn ? (org.atsLinkedAt ? `Linked to ${atsConn.label}` : `${atsConn.label} configured · not linked`) : undefined} />
        </SectionTitle>
        <div className="space-y-3 text-[13px] text-ink-2">
          {!atsConn ? (
            <p>Off. CSV import/export works in the meantime. To connect, point these variables at your ATS (directly, or through a small adapter implementing the Talyn ATS contract in docs/INTEGRATIONS.md):</p>
          ) : org.atsLinkedAt ? (
            <p>
              Linked by {org.atsLinkedBy} on {formatDateTime(org.atsLinkedAt)}. Syncs daily. Link each role to its ATS job and map stages on the role&apos;s <strong>ATS</strong> tab.{" "}
              {atsConn.canPushStages ? "Recruiter stage changes are pushed to the ATS." : "Read-only: stage changes are not pushed."}
            </p>
          ) : otherLinked ? (
            <p className="text-warn">Another workspace is linked to this ATS. Only one workspace can sync with it.</p>
          ) : (
            <p>Configured. Link this workspace to start syncing — nothing is pulled or pushed until you do.</p>
          )}
          <EnvList checks={ats.checks} />
          {atsConn && isAdmin && !otherLinked && <AtsButtons linked={!!org.atsLinkedAt} />}
          {conflicts > 0 && (
            <p>
              <Link href="/queue#q-ats" className="font-medium text-signal hover:underline">
                {conflicts} field conflict{conflicts === 1 ? "" : "s"} to review →
              </Link>
            </p>
          )}
          {failedPushes.length > 0 && (
            <div>
              <div className="font-medium text-danger">Stage changes the ATS didn&apos;t accept</div>
              <ul className="mt-1 divide-y divide-line">
                {failedPushes.map((o) => (
                  <li key={o.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                    <span>
                      {o.talynStage} → {o.atsStage} · {o.createdByName} · {formatDateTime(o.createdAt)} · {o.lastError}
                    </span>
                    <OutboxButtons id={o.id} />
                  </li>
                ))}
              </ul>
            </div>
          )}
          {runs.length > 0 && (
            <details>
              <summary className="cursor-pointer text-muted">Sync history</summary>
              <ul className="mt-1 space-y-1 text-[12.5px]">
                {runs.map((r) => {
                  const errs = JSON.parse(r.errorsJson) as { message: string }[];
                  return (
                    <li key={r.id}>
                      {formatDateTime(r.startedAt)} · {r.kind} · {RUN_LABEL[r.status] ?? r.status} · {r.created} created · {r.updated} updated · {r.unchanged} unchanged · {r.conflicts} conflicts ·{" "}
                      {r.triggeredBy}
                      {errs.length > 0 && <span className="text-warn"> · {errs.slice(0, 3).map((e) => e.message).join("; ")}</span>}
                    </li>
                  );
                })}
              </ul>
            </details>
          )}
        </div>
      </Card>

      <Card className="p-5">
        <SectionTitle>
          Scheduled jobs <Status on={cron.ready} label={cron.ready ? "Authorized" : "Not authorized"} />
        </SectionTitle>
        <p className="text-[13px] text-muted">Daily on Vercel: data retention, sending due outreach (only with an email provider) and ATS sync (only when linked). Each job does nothing until its integration is on.</p>
        <EnvList checks={cron.checks} />
      </Card>
    </div>
  );
}
