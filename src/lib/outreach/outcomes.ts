import "server-only";
import { audit } from "../audit";
import { db } from "../db";

/** Who reported an outcome. Recruiter entries are never shown as provider-confirmed. */
export type OutcomeActor = { orgId: string; userId: string | null; userName: string; providerConfirmed: boolean };
export type Outcome = "replied" | "declined" | "opted_out" | "bounced" | "delivered";

const LIVE = ["draft", "active", "paused"];

async function stop(actor: OutcomeActor, sequenceId: string, reason: string) {
  await db.$transaction([
    db.outreachSequence.update({ where: { id: sequenceId }, data: { status: "stopped", stopReason: reason } }),
    db.outreachMessage.updateMany({ where: { sequenceId, sentAt: null }, data: { status: "cancelled", dueAt: null } }),
  ]);
  await db.outreachEvent.create({ data: { orgId: actor.orgId, sequenceId, type: "stopped", actorName: actor.userName, providerConfirmed: actor.providerConfirmed, note: reason } });
}

/**
 * Applies the stop rules shared by recruiter entries, provider webhooks and the unsubscribe link:
 * replied → stop + reply task · declined → stop + record the decline as their expressed interest ·
 * opted_out → stop every live sequence for the candidate + block all channels ·
 * bounced → pause · delivered → mark delivered (provider only).
 */
export async function applyOutcome(actor: OutcomeActor, sequenceId: string, type: Outcome, opts: { messageId?: string | null; note?: string | null } = {}) {
  const seq = await db.outreachSequence.findFirst({
    where: { id: sequenceId, orgId: actor.orgId },
    include: { application: { select: { candidateId: true, roleId: true } }, messages: { orderBy: { step: "asc" } } },
  });
  if (!seq) return null;
  const msg = opts.messageId ? seq.messages.find((m) => m.id === opts.messageId) : [...seq.messages].reverse().find((m) => m.sentAt);
  const candidateId = seq.application.candidateId;

  if (type === "delivered") {
    if (!actor.providerConfirmed || !msg) return seq;
    await db.outreachMessage.update({ where: { id: msg.id }, data: { deliveredAt: new Date(), ...(msg.status === "sent" ? { status: "delivered" } : {}) } });
  } else {
    if (msg) await db.outreachMessage.update({ where: { id: msg.id }, data: { status: type } });
    if (type === "bounced") {
      if (seq.status === "active") await db.outreachSequence.update({ where: { id: sequenceId }, data: { status: "paused", stopReason: "bounced" } });
    } else if (LIVE.includes(seq.status)) {
      await stop(actor, sequenceId, type);
    }
    if (type === "declined")
      await db.application.update({ where: { id: seq.applicationId }, data: { interest: "declined", interestAt: new Date(), interestByName: actor.userName, interestNote: opts.note?.slice(0, 500) ?? "Declined in reply to outreach" } });
    if (type === "opted_out") {
      await db.candidate.update({
        where: { id: candidateId },
        data: { contactOptOut: true, optOutAt: new Date(), whatsappPermission: "withdrawn", whatsappPermissionAt: new Date(), whatsappPermissionNote: "Opted out of contact", whatsappPermissionBy: actor.userName },
      });
      const others = await db.outreachSequence.findMany({ where: { orgId: actor.orgId, id: { not: sequenceId }, status: { in: LIVE }, application: { candidateId } }, select: { id: true } });
      for (const o of others) await stop(actor, o.id, "opted_out");
    }
    if (type === "replied")
      await db.task.create({
        data: { orgId: actor.orgId, applicationId: seq.applicationId, type: "reply", title: "Respond to candidate reply", detailsJson: JSON.stringify({ sequenceId }), createdById: actor.userId, createdByName: actor.userName },
      });
  }
  await db.outreachEvent.create({
    data: { orgId: actor.orgId, sequenceId, messageId: msg?.id ?? null, type, actorName: actor.userName, providerConfirmed: actor.providerConfirmed, note: opts.note?.slice(0, 500) ?? null },
  });
  await audit(actor, type === "replied" ? "outreach.reply_recorded" : type === "declined" ? "outreach.declined_recorded" : type === "opted_out" ? "outreach.opt_out_recorded" : type === "bounced" ? "outreach.paused" : "outreach.delivered", {
    subjectType: "outreach",
    subjectId: sequenceId,
    candidateId,
    roleId: seq.application.roleId,
    applicationId: seq.applicationId,
    meta: { outcome: type, providerConfirmed: actor.providerConfirmed },
  });
  return seq;
}
