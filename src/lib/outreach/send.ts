import "server-only";
import { audit } from "../audit";
import { db } from "../db";
import { logError, logInfo } from "../log";
import { getEmailProvider } from "./provider";
import { unsubscribeUrl } from "./signing";

/**
 * Sends due, recruiter-approved messages in ACTIVE sequences through the configured provider.
 * Opt-out, missing email and sequence status are re-checked immediately before each send.
 * Returns null when no provider is configured (nothing is sent).
 */
export async function sendDueMessages(opts: { orgId?: string; limit?: number; triggeredBy: string }) {
  const provider = getEmailProvider();
  if (!provider) return null;
  const due = await db.outreachMessage.findMany({
    where: { status: "approved", sentAt: null, dueAt: { lte: new Date() }, sequence: { status: "active" }, ...(opts.orgId ? { orgId: opts.orgId } : {}) },
    include: { sequence: { include: { application: { include: { candidate: true } } } } },
    orderBy: { dueAt: "asc" },
    take: opts.limit ?? 100,
  });
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const m of due) {
    // Re-read the latest state: a reply/opt-out may have arrived since the query.
    const fresh = await db.outreachMessage.findUnique({ where: { id: m.id }, include: { sequence: { select: { status: true } } } });
    const c = await db.candidate.findUnique({ where: { id: m.sequence.application.candidateId }, select: { id: true, email: true, contactOptOut: true } });
    if (!fresh || fresh.sentAt || fresh.status !== "approved" || fresh.sequence.status !== "active" || !c || c.contactOptOut || !c.email) {
      skipped++;
      continue;
    }
    const unsub = unsubscribeUrl(m.id);
    try {
      const r = await provider.send({
        to: c.email,
        from: process.env.OUTREACH_FROM_EMAIL!,
        replyTo: process.env.OUTREACH_REPLY_TO || undefined,
        subject: m.subject,
        text: `${m.body}\n\n—\nTo stop hearing from us: ${unsub}`,
        headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
      });
      const next = await db.outreachMessage.findFirst({ where: { sequenceId: m.sequenceId, step: m.step + 1 } });
      const now = new Date();
      await db.$transaction([
        db.outreachMessage.update({ where: { id: m.id }, data: { status: "sent", sentAt: now, sentVia: provider.key, providerMessageId: r.providerMessageId || null, toEmail: c.email } }),
        db.outreachEvent.create({ data: { orgId: m.orgId, sequenceId: m.sequenceId, messageId: m.id, type: "sent", providerConfirmed: true, actorName: provider.label, note: "Accepted by the mail server" } }),
        ...(next ? [db.outreachMessage.update({ where: { id: next.id }, data: { dueAt: new Date(now.getTime() + next.delayDays * 86400000) } })] : []),
        ...(!next ? [db.outreachSequence.update({ where: { id: m.sequenceId }, data: { status: "completed" } })] : []),
      ]);
      await audit({ orgId: m.orgId, userId: null, userName: opts.triggeredBy }, "outreach.sent", {
        subjectType: "outreach",
        subjectId: m.id,
        candidateId: c.id,
        applicationId: m.applicationId,
        meta: { step: m.step, provider: provider.key },
      });
      sent++;
    } catch (err) {
      failed++;
      logError("outreach.send_failed", err, { messageId: m.id });
      await db.outreachEvent.create({ data: { orgId: m.orgId, sequenceId: m.sequenceId, messageId: m.id, type: "send_failed", providerConfirmed: true, actorName: provider.label, note: "The mail server rejected or didn't accept the message. It will be retried on the next run." } });
    }
  }
  logInfo("outreach.send_due", { due: due.length, sent, skipped, failed });
  return { due: due.length, sent, skipped, failed };
}
