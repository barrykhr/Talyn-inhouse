import "server-only";
import nodemailer from "nodemailer";
import { checkEnv } from "../integrations/env";

/**
 * Email sending. Talyn sends only recruiter-approved messages in sequences a recruiter
 * explicitly activated. The built-in provider is vendor-neutral SMTP (works with Google
 * Workspace, Microsoft 365, Amazon SES, SendGrid, Postmark, Mailgun and most mail services).
 * It stays off until every required variable below is set.
 *
 * SMTP only confirms that the mail server *accepted* a message. Delivered / bounced / replied /
 * opted-out are marked provider-confirmed only when they arrive through /api/webhooks/email
 * (or the candidate uses the unsubscribe link). Otherwise recruiters record them.
 */
export interface EmailProvider {
  key: string;
  label: string;
  send(msg: { to: string; from: string; replyTo?: string; subject: string; text: string; headers?: Record<string, string> }): Promise<{ providerMessageId: string }>;
}

export const EMAIL_ENV = [
  { name: "SMTP_HOST", purpose: "Mail server host, e.g. smtp.gmail.com, smtp.office365.com, email-smtp.<region>.amazonaws.com" },
  { name: "SMTP_PORT", purpose: "Port (default 587 with STARTTLS; 465 for implicit TLS)", optional: true },
  { name: "SMTP_USER", purpose: "SMTP username" },
  { name: "SMTP_PASS", purpose: "SMTP password or app password", secret: true },
  { name: "OUTREACH_FROM_EMAIL", purpose: "Sender, e.g. \"Acme Talent <talent@acme.com>\" — must be allowed by your mail service" },
  { name: "OUTREACH_REPLY_TO", purpose: "Where candidate replies go (defaults to the sender)", optional: true },
  { name: "OUTREACH_SECRET", purpose: "Random string used to sign unsubscribe links", secret: true },
  { name: "EMAIL_WEBHOOK_SECRET", purpose: "Bearer token your mail service uses to report delivered/bounced/replied events", secret: true, optional: true },
];

export function emailSetup() {
  return checkEnv(EMAIL_ENV);
}

let cached: EmailProvider | null | undefined;

export function getEmailProvider(): EmailProvider | null {
  if (cached !== undefined) return cached;
  if (!emailSetup().ready) return (cached = null);
  const port = Number(process.env.SMTP_PORT || 587);
  const transport = nodemailer.createTransport({
    host: process.env.SMTP_HOST,
    port,
    secure: port === 465,
    requireTLS: port !== 465,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    disableFileAccess: true,
    disableUrlAccess: true,
  });
  cached = {
    key: "smtp",
    label: `SMTP (${process.env.SMTP_HOST})`,
    async send(msg) {
      const info = await transport.sendMail({ to: msg.to, from: msg.from, replyTo: msg.replyTo, subject: msg.subject, text: msg.text, headers: msg.headers });
      return { providerMessageId: String(info.messageId ?? "").replace(/^<|>$/g, "") };
    },
  };
  return cached;
}

export const SENDING_SETUP_HINT =
  "No email provider is connected, so Talyn doesn't send email. Send approved messages from your own mail client and record them as sent. To enable sending, add SMTP settings for your mail service (Settings → Integrations).";
