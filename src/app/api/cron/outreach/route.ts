import { db } from "@/lib/db";
import { logError, logInfo } from "@/lib/log";
import { getEmailProvider } from "@/lib/outreach/provider";

// Sends due, recruiter-approved messages in ACTIVE sequences via the configured email provider.
// With no provider configured (the current setup) it does nothing. Protected by CRON_SECRET.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const provider = getEmailProvider();
  if (!provider) return Response.json({ ok: true, skipped: "No email provider configured; messages are sent manually by recruiters." });

  const due = await db.outreachMessage.findMany({
    where: { status: "approved", sentAt: null, dueAt: { lte: new Date() }, sequence: { status: "active" } },
    include: { sequence: { include: { application: { include: { candidate: true } } } } },
    take: 100,
  });
  let sent = 0;
  for (const m of due) {
    const c = m.sequence.application.candidate;
    if (c.contactOptOut || !c.email) continue; // re-checked at send time
    try {
      const r = await provider.send({ to: c.email, from: process.env.OUTREACH_FROM_EMAIL ?? "", subject: m.subject, text: m.body });
      const next = await db.outreachMessage.findFirst({ where: { sequenceId: m.sequenceId, step: m.step + 1 } });
      const now = new Date();
      await db.$transaction([
        db.outreachMessage.update({ where: { id: m.id }, data: { status: "sent", sentAt: now, sentVia: provider.key, providerMessageId: r.providerMessageId, toEmail: c.email } }),
        db.outreachEvent.create({ data: { orgId: m.orgId, sequenceId: m.sequenceId, messageId: m.id, type: "sent", providerConfirmed: true, actorName: provider.label } }),
        ...(next ? [db.outreachMessage.update({ where: { id: next.id }, data: { dueAt: new Date(now.getTime() + next.delayDays * 86400000) } })] : []),
        ...(!next ? [db.outreachSequence.update({ where: { id: m.sequenceId }, data: { status: "completed" } })] : []),
      ]);
      sent++;
    } catch (err) {
      logError("outreach.send_failed", err, { messageId: m.id });
    }
  }
  logInfo("cron.outreach", { due: due.length, sent });
  return Response.json({ ok: true, sent });
}
