import "server-only";
import { audit } from "../audit";
import { db } from "../db";
import { logError, logInfo } from "../log";
import { getEmailProvider } from "./provider";
import { unsubscribeUrl } from "./signing";
import { sendWhatsAppTemplate, waNumber, whatsappConfigured } from "./whatsapp";

/**
 * Sends due, recruiter-approved messages in ACTIVE sequences through the provider for each
 * sequence's channel. Immediately before each send it re-checks: sequence still active, message
 * approved, no opt-out, contact details present, and — for WhatsApp — recorded permission.
 * Returns null when no sending provider is configured (nothing is sent).
 */
export async function sendDueMessages(opts: { orgId?: string; sequenceId?: string; limit?: number; triggeredBy: string }) {
  const email = getEmailProvider();
  const wa = whatsappConfigured();
  if (!email && !wa) return null;
  const channels = [...(email ? ["email"] : []), ...(wa ? ["whatsapp"] : [])];
  const due = await db.outreachMessage.findMany({
    where: {
      status: "approved",
      sentAt: null,
      dueAt: { lte: new Date() },
      sequence: { status: "active", channel: { in: channels }, ...(opts.sequenceId ? { id: opts.sequenceId } : {}) },
      ...(opts.orgId ? { orgId: opts.orgId } : {}),
    },
    include: { sequence: { include: { application: { include: { role: { select: { title: true } } } } } } },
    orderBy: { dueAt: "asc" },
    take: opts.limit ?? 100,
  });
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const m of due) {
    // Re-read the latest state: a reply, decline or opt-out may have arrived since the query.
    const fresh = await db.outreachMessage.findUnique({ where: { id: m.id }, include: { sequence: { select: { status: true, channel: true } } } });
    const c = await db.candidate.findUnique({
      where: { id: m.sequence.application.candidateId },
      select: { id: true, fullName: true, email: true, phone: true, contactOptOut: true, isSample: true, whatsappPermission: true },
    });
    const channel = fresh?.sequence.channel ?? "email";
    const to = channel === "whatsapp" ? waNumber(c?.phone) : c?.email;
    const allowed = !!c && !c.contactOptOut && !c.isSample && !!to && (channel !== "whatsapp" || c.whatsappPermission === "granted");
    if (!fresh || fresh.sentAt || fresh.status !== "approved" || fresh.sequence.status !== "active" || !allowed) {
      skipped++;
      continue;
    }
    try {
      let providerMessageId = "";
      let via = "";
      let label = "";
      if (channel === "whatsapp") {
        const org = await db.organization.findUnique({ where: { id: m.orgId }, select: { name: true } });
        const r = await sendWhatsAppTemplate(to!, {
          first_name: c!.fullName.split(/\s+/)[0],
          role_title: m.sequence.application.role.title,
          company: org?.name ?? "",
          recruiter_name: m.senderName ?? "",
          message: m.body,
        });
        providerMessageId = r.providerMessageId;
        via = "whatsapp";
        label = "WhatsApp Business Platform";
      } else {
        const unsub = unsubscribeUrl(m.id);
        const r = await email!.send({
          to: to!,
          from: process.env.OUTREACH_FROM_EMAIL!,
          replyTo: process.env.OUTREACH_REPLY_TO || undefined,
          subject: m.subject,
          text: `${m.body}\n\n—\nTo stop hearing from us: ${unsub}`,
          headers: { "List-Unsubscribe": `<${unsub}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" },
        });
        providerMessageId = r.providerMessageId;
        via = email!.key;
        label = email!.label;
      }
      const next = await db.outreachMessage.findFirst({ where: { sequenceId: m.sequenceId, step: m.step + 1 } });
      const now = new Date();
      await db.$transaction([
        db.outreachMessage.update({
          where: { id: m.id },
          data: { status: "sent", sentAt: now, sentVia: via, providerMessageId: providerMessageId || null, ...(channel === "whatsapp" ? { toPhone: to } : { toEmail: to }) },
        }),
        db.outreachEvent.create({ data: { orgId: m.orgId, sequenceId: m.sequenceId, messageId: m.id, type: "sent", providerConfirmed: true, actorName: label, note: channel === "whatsapp" ? "Accepted by WhatsApp" : "Accepted by the mail server" } }),
        ...(next ? [db.outreachMessage.update({ where: { id: next.id }, data: { dueAt: new Date(now.getTime() + next.delayDays * 86400000) } })] : []),
        ...(!next ? [db.outreachSequence.update({ where: { id: m.sequenceId }, data: { status: "completed" } })] : []),
      ]);
      await audit({ orgId: m.orgId, userId: null, userName: opts.triggeredBy }, "outreach.sent", {
        subjectType: "outreach",
        subjectId: m.id,
        candidateId: c!.id,
        applicationId: m.applicationId,
        meta: { step: m.step, channel, provider: via },
      });
      sent++;
    } catch (err) {
      failed++;
      logError("outreach.send_failed", err, { messageId: m.id, channel });
      await db.outreachEvent.create({
        data: {
          orgId: m.orgId,
          sequenceId: m.sequenceId,
          messageId: m.id,
          type: "send_failed",
          providerConfirmed: true,
          actorName: channel === "whatsapp" ? "WhatsApp Business Platform" : "Email provider",
          note: "The provider didn't accept the message. It will be retried on the next run.",
        },
      });
    }
  }
  logInfo("outreach.send_due", { due: due.length, sent, skipped, failed });
  return { due: due.length, sent, skipped, failed };
}
