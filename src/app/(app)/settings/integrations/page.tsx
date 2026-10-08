import Link from "next/link";
import { Card, PageHeader, SectionTitle, formatDateTime } from "@/components/ui";
import { PROVIDER_LABEL, aiStatus } from "@/lib/ai";
import { ATS_ENV, atsSetup, getAtsConnector } from "@/lib/ats/connector";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appUrl, checkEnv, type EnvCheck } from "@/lib/integrations/env";
import { EMAIL_ENV, emailSetup, getEmailProvider } from "@/lib/outreach/provider";
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

export default async function IntegrationsPage() {
  const auth = await requireAuth();
  const isAdmin = auth.membershipRole === "admin";
  const ai = aiStatus();
  const email = emailSetup();
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
      <PageHeader eyebrow={<Link href="/settings">← Settings</Link>} title="Integrations" />
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
          {provider && isAdmin && <EmailButtons />}
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
            <p className="text-muted">On a role&apos;s Sourcing tab, import a CSV exported from a source your organization is licensed to use. The recruiter names the source and confirms the licence.</p>
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
