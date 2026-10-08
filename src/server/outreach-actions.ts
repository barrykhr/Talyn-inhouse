"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, OUTREACH_ENGINE_VERSION, aiStatus, draftOutreachWithAi } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from "@/lib/domain";
import { logError } from "@/lib/log";
import { OPT_OUT_FOOTER, fillTemplate, personalizationFacts } from "@/lib/outreach/facts";
import { str, type ActionState } from "./form";
import { ownApplication } from "./scope";

const LIVE = ["draft", "active", "paused"];

async function ownSequence(auth: AuthContext, id: string) {
  return db.outreachSequence.findFirst({ where: { id, orgId: auth.orgId }, include: { application: { include: { candidate: true, role: true } }, messages: { orderBy: { step: "asc" } } } });
}
async function ownMessage(auth: AuthContext, id: string) {
  return db.outreachMessage.findFirst({ where: { id, orgId: auth.orgId }, include: { sequence: { include: { application: true } } } });
}
const refresh = (candidateId: string) => {
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath("/queue");
};
const event = (orgId: string, sequenceId: string, type: string, actorName: string, extra: { messageId?: string; note?: string } = {}) =>
  db.outreachEvent.create({ data: { orgId, sequenceId, type, actorName, providerConfirmed: false, messageId: extra.messageId ?? null, note: extra.note ?? null } });

/** Drafts a 1–3 step sequence for one application. Drafts only — nothing is approved or sent. */
export async function draftSequence(applicationId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const [candidate, role, org] = await Promise.all([
    db.candidate.findFirstOrThrow({ where: { id: app.candidateId, orgId: auth.orgId } }),
    db.role.findFirstOrThrow({ where: { id: app.roleId, orgId: auth.orgId }, include: { criteria: { where: { status: "approved" }, orderBy: { position: "asc" }, take: 3 } } }),
    db.organization.findUniqueOrThrow({ where: { id: auth.orgId } }),
  ]);
  if (candidate.contactOptOut) return { error: "This candidate opted out of contact. Outreach is blocked." };
  const existing = await db.outreachSequence.findFirst({ where: { applicationId, orgId: auth.orgId, status: { in: ["active", "paused"] } } });
  if (existing) return { error: "There is already an active or paused sequence. Stop it before drafting a new one." };

  const steps = Math.min(3, Math.max(1, Number(str(fd, "steps")) || 1));
  const delays = [0, Number(str(fd, "delay2")) || 4, Number(str(fd, "delay3")) || 7].map((d) => Math.min(30, Math.max(0, d)));
  const templateId = str(fd, "templateId");
  const template = templateId ? await db.outreachTemplate.findFirst({ where: { id: templateId, orgId: auth.orgId } }) : null;
  const facts = await personalizationFacts(auth.orgId, candidate.id);
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const vars = { first_name: byKey.get("first_name")?.value, role_title: role.title, company: org.name, current_title: byKey.get("current_title")?.value };
  const ai = aiStatus();

  const drafts: { subject: string; body: string; used: typeof facts; generator: string }[] = [];
  let notice: string | undefined;
  for (let step = 1; step <= steps; step++) {
    if (template && step === 1) {
      const used = facts.filter((f) => new RegExp(`\\{\\{\\s*${f.key}\\s*\\}\\}`).test(template.body + template.subject));
      drafts.push({ subject: fillTemplate(template.subject, vars), body: fillTemplate(template.body, vars), used, generator: `template:${template.id}` });
      continue;
    }
    try {
      if (!ai.configured) throw new AiUnavailableError();
      const r = await draftOutreachWithAi({
        company: org.name,
        role: { title: role.title, location: role.location, employmentType: EMPLOYMENT_TYPE_LABEL[role.employmentType as EmploymentType] ?? role.employmentType, highlights: role.criteria.map((c) => c.name) },
        facts: facts.map(({ key, label, value }) => ({ key, label, value })),
        step,
        previous: drafts[step - 2]?.body ?? null,
        senderName: auth.userName,
      });
      // Keep only facts that really were provided; anything else would be invented.
      const used = r.facts_used.map((k) => byKey.get(k)).filter((f): f is (typeof facts)[number] => !!f);
      drafts.push({ subject: r.subject.slice(0, 200), body: r.body.slice(0, 5000), used, generator: `ai:${ai.provider}:${ai.model}/${OUTREACH_ENGINE_VERSION}` });
    } catch (err) {
      if (!(err instanceof AiUnavailableError || err instanceof AiRequestError)) logError("outreach.draft_failed", err);
      notice = err instanceof AiUnavailableError ? "AI is off — drafts use a plain starting message. Edit before approving." : "AI drafting failed — drafts use a plain starting message.";
      const first = vars.first_name ? `Hi ${vars.first_name},` : "Hi,";
      const body =
        step === 1
          ? `${first}\n\nI'm ${auth.userName}, recruiting at ${org.name}. We're hiring a ${role.title}${role.location ? ` (${role.location})` : ""} and your background looks relevant. Would you be open to a short conversation?\n\nBest,\n${auth.userName}`
          : `${first}\n\nFollowing up on my note about the ${role.title} role at ${org.name}. Happy to share more, or no worries if the timing isn't right.\n\nBest,\n${auth.userName}`;
      drafts.push({ subject: step === 1 ? `${role.title} at ${org.name}` : `Re: ${role.title} at ${org.name}`, body, used: vars.first_name ? facts.filter((f) => f.key === "first_name") : [], generator: "recruiter-template:plain-v1" });
    }
  }

  await db.outreachSequence.deleteMany({ where: { applicationId, orgId: auth.orgId, status: "draft" } });
  const seq = await db.outreachSequence.create({
    data: {
      orgId: auth.orgId,
      applicationId,
      createdByName: auth.userName,
      messages: {
        create: drafts.map((d, i) => {
          const body = d.body + OPT_OUT_FOOTER;
          return {
            orgId: auth.orgId,
            applicationId,
            step: i + 1,
            delayDays: delays[i],
            subject: d.subject,
            body,
            draftSubject: d.subject,
            draftBody: body,
            personalizationJson: JSON.stringify(d.used),
            generator: d.generator,
            senderName: auth.userName,
          };
        }),
      },
    },
  });
  await event(auth.orgId, seq.id, "drafted", auth.userName);
  await audit(auth, "outreach.drafted", { subjectType: "outreach", subjectId: seq.id, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { steps, ai: drafts.some((d) => d.generator.startsWith("ai:")) } });
  refresh(app.candidateId);
  return { ok: true, message: notice ?? `${steps}-step draft ready. Review, edit and approve each message.` };
}

/** Edits a message. Any change after approval returns it to draft so it must be re-approved. */
export async function updateMessage(messageId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const m = await ownMessage(auth, messageId);
  if (!m) return { error: "Message not found." };
  if (m.sentAt) return { error: "This message was already sent." };
  if (!["draft", "paused"].includes(m.sequence.status)) return { error: "Pause the sequence before editing." };
  const subject = str(fd, "subject", 200);
  const body = str(fd, "body", 6000);
  const delayDays = Math.min(30, Math.max(0, Number(str(fd, "delayDays")) || m.delayDays));
  if (!subject || !body) return { error: "Subject and message can't be empty." };
  const changed = subject !== m.subject || body !== m.body || delayDays !== m.delayDays;
  await db.outreachMessage.update({ where: { id: messageId }, data: { subject, body, delayDays, ...(changed ? { status: "draft", approvedByName: null, approvedAt: null } : {}) } });
  refresh(m.sequence.application.candidateId);
  return { ok: true, message: changed ? "Saved — approve it again before activating" : "No changes" };
}

export async function approveMessage(messageId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const m = await ownMessage(auth, messageId);
  if (!m) return { error: "Message not found." };
  if (m.status !== "draft") return { ok: true };
  await db.outreachMessage.update({ where: { id: messageId }, data: { status: "approved", approvedByName: auth.userName, approvedAt: new Date() } });
  await event(auth.orgId, m.sequenceId, "approved", auth.userName, { messageId });
  await audit(auth, "outreach.approved", { subjectType: "outreach", subjectId: messageId, candidateId: m.sequence.application.candidateId, roleId: m.sequence.application.roleId, applicationId: m.applicationId, meta: { step: m.step } });
  refresh(m.sequence.application.candidateId);
  return { ok: true };
}

/** Explicit recruiter activation. Requires every step approved, an email on file and no opt-out. */
export async function activateSequence(sequenceId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const seq = await ownSequence(auth, sequenceId);
  if (!seq) return { error: "Sequence not found." };
  const c = seq.application.candidate;
  if (c.contactOptOut) return { error: "The candidate opted out. Outreach is blocked." };
  if (!c.email) return { error: "No email address on file. Add one in Edit profile — Talyn never guesses contact details." };
  if (seq.messages.some((m) => m.status === "draft")) return { error: "Approve every message first." };
  if (!["draft", "paused"].includes(seq.status)) return { error: "This sequence can't be activated." };
  const now = new Date();
  const first = seq.messages.find((m) => !m.sentAt);
  await db.$transaction([
    db.outreachSequence.update({ where: { id: sequenceId }, data: { status: "active", stopReason: null, activatedByName: auth.userName, activatedAt: now } }),
    ...(first && !first.dueAt ? [db.outreachMessage.update({ where: { id: first.id }, data: { dueAt: now } })] : []),
  ]);
  await event(auth.orgId, sequenceId, seq.status === "paused" ? "resumed" : "activated", auth.userName);
  await audit(auth, "outreach.activated", { subjectType: "outreach", subjectId: sequenceId, candidateId: c.id, roleId: seq.application.roleId, applicationId: seq.applicationId, meta: { steps: seq.messages.length } });
  refresh(c.id);
  return { ok: true };
}

export async function pauseSequence(sequenceId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const seq = await ownSequence(auth, sequenceId);
  if (!seq || seq.status !== "active") return { error: "Only an active sequence can be paused." };
  await db.outreachSequence.update({ where: { id: sequenceId }, data: { status: "paused", stopReason: "recruiter" } });
  await event(auth.orgId, sequenceId, "paused", auth.userName);
  await audit(auth, "outreach.paused", { subjectType: "outreach", subjectId: sequenceId, candidateId: seq.application.candidateId, roleId: seq.application.roleId, applicationId: seq.applicationId });
  refresh(seq.application.candidateId);
  return { ok: true };
}

async function stopInternal(auth: AuthContext, sequenceId: string, reason: string) {
  await db.$transaction([
    db.outreachSequence.update({ where: { id: sequenceId }, data: { status: "stopped", stopReason: reason } }),
    db.outreachMessage.updateMany({ where: { sequenceId, sentAt: null }, data: { status: "cancelled", dueAt: null } }),
  ]);
  await event(auth.orgId, sequenceId, "stopped", auth.userName, { note: reason });
}

export async function stopSequence(sequenceId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const seq = await ownSequence(auth, sequenceId);
  if (!seq || !LIVE.includes(seq.status)) return { error: "Nothing to stop." };
  await stopInternal(auth, sequenceId, "recruiter");
  await audit(auth, "outreach.stopped", { subjectType: "outreach", subjectId: sequenceId, candidateId: seq.application.candidateId, roleId: seq.application.roleId, applicationId: seq.applicationId, meta: { reason: "recruiter" } });
  refresh(seq.application.candidateId);
  return { ok: true };
}

/** Manual sending: the recruiter sent it from their own mail client. Recorded, not provider-confirmed. */
export async function recordSent(messageId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const m = await ownMessage(auth, messageId);
  if (!m) return { error: "Message not found." };
  if (m.sequence.status !== "active") return { error: "Activate the sequence first." };
  if (m.status !== "approved" || m.sentAt) return { error: "This message isn't ready to send." };
  const c = await db.candidate.findFirstOrThrow({ where: { id: m.sequence.application.candidateId, orgId: auth.orgId } });
  if (c.contactOptOut) return { error: "The candidate opted out." };
  const now = new Date();
  const next = await db.outreachMessage.findFirst({ where: { sequenceId: m.sequenceId, step: m.step + 1 } });
  await db.$transaction([
    db.outreachMessage.update({ where: { id: messageId }, data: { status: "sent", sentAt: now, sentVia: "manual", toEmail: c.email, senderName: auth.userName } }),
    ...(next ? [db.outreachMessage.update({ where: { id: next.id }, data: { dueAt: new Date(now.getTime() + next.delayDays * 86400000) } })] : []),
    ...(!next ? [db.outreachSequence.update({ where: { id: m.sequenceId }, data: { status: "completed" } })] : []),
  ]);
  await event(auth.orgId, m.sequenceId, "sent", auth.userName, { messageId, note: "Recorded by recruiter (sent from their own mail client)" });
  await audit(auth, "outreach.sent_recorded", { subjectType: "outreach", subjectId: messageId, candidateId: c.id, roleId: m.sequence.application.roleId, applicationId: m.applicationId, meta: { step: m.step } });
  refresh(c.id);
  return { ok: true };
}

/** Recruiter-recorded outcomes. Replies and opt-outs stop follow-ups; bounces pause them. */
export async function recordOutcome(sequenceId: string, type: "replied" | "opted_out" | "bounced", note?: string): Promise<ActionState> {
  const auth = await requireAuth();
  const seq = await ownSequence(auth, sequenceId);
  if (!seq) return { error: "Sequence not found." };
  const t = z.enum(["replied", "opted_out", "bounced"]).parse(type);
  const lastSent = [...seq.messages].reverse().find((m) => m.sentAt);
  const candidateId = seq.application.candidateId;
  if (lastSent) await db.outreachMessage.update({ where: { id: lastSent.id }, data: { status: t } });
  if (t === "bounced") {
    if (seq.status === "active") await db.outreachSequence.update({ where: { id: sequenceId }, data: { status: "paused", stopReason: "bounced" } });
  } else {
    await stopInternal(auth, sequenceId, t);
  }
  if (t === "opted_out") await db.candidate.update({ where: { id: candidateId }, data: { contactOptOut: true, optOutAt: new Date() } });
  if (t === "replied")
    await db.task.create({
      data: {
        orgId: auth.orgId,
        applicationId: seq.applicationId,
        type: "reply",
        title: "Respond to candidate reply",
        detailsJson: JSON.stringify({ sequenceId }),
        createdById: auth.userId,
        createdByName: auth.userName,
      },
    });
  await event(auth.orgId, sequenceId, t, auth.userName, { messageId: lastSent?.id, note: note?.slice(0, 500) });
  await audit(auth, t === "replied" ? "outreach.reply_recorded" : t === "opted_out" ? "outreach.opt_out_recorded" : "outreach.paused", {
    subjectType: "outreach",
    subjectId: sequenceId,
    candidateId,
    roleId: seq.application.roleId,
    applicationId: seq.applicationId,
    meta: { outcome: t },
  });
  refresh(candidateId);
  return { ok: true };
}

/**
 * Saves a message as an org-wide template. Candidate-specific values that were used for
 * personalization are replaced with placeholders so no candidate data leaks into templates.
 */
export async function saveTemplate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const m = await ownMessage(auth, str(fd, "messageId"));
  if (!m) return { error: "Message not found." };
  const facts = JSON.parse(m.personalizationJson) as { key: string; value: string }[];
  const role = await db.role.findFirst({ where: { id: m.sequence.application.roleId, orgId: auth.orgId }, select: { title: true } });
  const placeholders: [string, string][] = [
    ...facts.filter((f) => ["first_name", "current_title", "current_company", "location"].includes(f.key)).map((f) => [f.value, `{{${f.key}}}`] as [string, string]),
    ...(role ? ([[role.title, "{{role_title}}"]] as [string, string][]) : []),
  ];
  const scrub = (t: string) => placeholders.reduce((acc, [v, p]) => (v.length > 1 ? acc.split(v).join(p) : acc), t);
  const name = `${role?.title ?? "Outreach"} · step ${m.step}`;
  const subject = scrub(m.subject);
  const body = scrub(m.body.replace(OPT_OUT_FOOTER.trim(), "").trim());
  await db.outreachTemplate.create({ data: { orgId: auth.orgId, name, subject, body, createdByName: auth.userName } });
  return { ok: true, message: "Template saved — candidate details replaced with placeholders. Review it before reuse." };
}

export async function deleteTemplate(id: string): Promise<ActionState> {
  const auth = await requireAuth();
  await db.outreachTemplate.deleteMany({ where: { id, orgId: auth.orgId } });
  revalidatePath("/settings/templates");
  return { ok: true };
}
