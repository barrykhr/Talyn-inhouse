"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, OUTREACH_ENGINE_VERSION, aiStatus, draftOutreachWithAi } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from "@/lib/domain";
import { logError } from "@/lib/log";
import { OPT_OUT_FOOTER, fillTemplate, personalizationFacts, type PersonalizationFact } from "@/lib/outreach/facts";
import { waNumber, whatsappConfigured } from "@/lib/outreach/whatsapp";
import { applyOutcome } from "@/lib/outreach/outcomes";
import { getEmailProvider } from "@/lib/outreach/provider";
import { sendDueMessages } from "@/lib/outreach/send";
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

type Draft = { subject: string; body: string; used: PersonalizationFact[]; generator: string };

/** Drafts one step from the role and the candidate's confirmed facts / Discover evidence only. */
async function draftStep(input: {
  auth: AuthContext;
  channel: "email" | "whatsapp";
  step: number;
  previous: string | null;
  facts: PersonalizationFact[];
  role: { title: string; location: string; employmentType: string; criteria: { name: string }[] };
  company: string;
}): Promise<Draft & { fallback?: string }> {
  const { auth, channel, step, facts, role, company } = input;
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const ai = aiStatus();
  try {
    if (!ai.configured) throw new AiUnavailableError();
    const r = await draftOutreachWithAi({
      channel,
      company,
      role: { title: role.title, location: role.location, employmentType: EMPLOYMENT_TYPE_LABEL[role.employmentType as EmploymentType] ?? role.employmentType, highlights: role.criteria.map((c) => c.name) },
      facts: facts.map(({ key, label, value }) => ({ key, label, value })),
      step,
      previous: input.previous,
      senderName: auth.userName,
    });
    // Keep only facts that really were provided; anything else would be invented.
    const used = r.facts_used.map((k) => byKey.get(k)).filter((f): f is PersonalizationFact => !!f);
    return { subject: channel === "whatsapp" ? "WhatsApp" : r.subject.slice(0, 200), body: r.body.slice(0, channel === "whatsapp" ? 1000 : 5000), used, generator: `ai:${ai.provider}:${ai.model}/${OUTREACH_ENGINE_VERSION}` };
  } catch (err) {
    if (!(err instanceof AiUnavailableError || err instanceof AiRequestError)) logError("outreach.draft_failed", err);
    const firstName = byKey.get("first_name")?.value;
    const hi = firstName ? `Hi ${firstName},` : "Hi,";
    const ev = facts.filter((f) => f.key.startsWith("evidence_")).slice(0, 2);
    const why = ev.length ? ` Your profile mentions ${ev.map((f) => f.label.replace(/^Profile mentions /, "")).join(" and ")}, which is relevant to the role.` : "";
    const body =
      channel === "whatsapp"
        ? step === 1
          ? `${hi} I'm ${auth.userName}, a recruiter at ${company}. We're hiring a ${role.title}.${why} Would you be open to a short chat?`
          : `${hi} just following up on the ${role.title} role at ${company}. No problem if the timing isn't right.`
        : step === 1
          ? `${hi}\n\nI'm ${auth.userName}, recruiting at ${company}. We're hiring a ${role.title}${role.location ? ` (${role.location})` : ""}.${why} Would you be open to a short conversation?\n\nBest,\n${auth.userName}`
          : `${hi}\n\nFollowing up on my note about the ${role.title} role at ${company}. Happy to share more, or no worries if the timing isn't right.\n\nBest,\n${auth.userName}`;
    return {
      subject: channel === "whatsapp" ? "WhatsApp" : step === 1 ? `${role.title} at ${company}` : `Re: ${role.title} at ${company}`,
      body,
      used: [...(firstName ? facts.filter((f) => f.key === "first_name") : []), ...ev],
      generator: "recruiter-template:plain-v1",
      fallback: err instanceof AiUnavailableError ? "AI is off — drafts use a plain starting message built from the evidence. Edit before approving." : "AI drafting failed — drafts use a plain starting message.",
    };
  }
}

async function draftContext(auth: AuthContext, applicationId: string) {
  const app = await ownApplication(auth, applicationId);
  const [candidate, role, org] = await Promise.all([
    db.candidate.findFirstOrThrow({ where: { id: app.candidateId, orgId: auth.orgId } }),
    db.role.findFirstOrThrow({ where: { id: app.roleId, orgId: auth.orgId }, include: { criteria: { where: { status: "approved" }, orderBy: { position: "asc" }, take: 3 } } }),
    db.organization.findUniqueOrThrow({ where: { id: auth.orgId } }),
  ]);
  const facts = await personalizationFacts(auth.orgId, candidate.id, applicationId);
  return { app, candidate, role, org, facts };
}

/**
 * Drafts a first message plus 2–3 follow-ups for one application and channel. Drafts only —
 * nothing is approved, activated or sent.
 */
export async function draftSequence(applicationId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const { app, candidate, role, org, facts } = await draftContext(auth, applicationId);
  if (candidate.contactOptOut) return { error: "This candidate opted out of contact. Outreach is blocked." };
  const existing = await db.outreachSequence.findFirst({ where: { applicationId, orgId: auth.orgId, status: { in: ["active", "paused"] } } });
  if (existing) return { error: "There is already an active or paused sequence. Cancel it before drafting a new one." };

  const channel = str(fd, "channel") === "whatsapp" ? "whatsapp" : "email";
  const followUps = Math.min(3, Math.max(2, Number(str(fd, "followUps")) || 2));
  const steps = 1 + followUps;
  const delays = [0, Number(str(fd, "delay2")) || 4, Number(str(fd, "delay3")) || 7, Number(str(fd, "delay4")) || 14].map((d) => Math.min(30, Math.max(1, d)));
  delays[0] = 0;
  const templateId = channel === "email" ? str(fd, "templateId") : "";
  const template = templateId ? await db.outreachTemplate.findFirst({ where: { id: templateId, orgId: auth.orgId } }) : null;
  const byKey = new Map(facts.map((f) => [f.key, f]));
  const vars = { first_name: byKey.get("first_name")?.value, role_title: role.title, company: org.name, current_title: byKey.get("current_title")?.value };

  const drafts: Draft[] = [];
  let notice: string | undefined;
  for (let step = 1; step <= steps; step++) {
    if (template && step === 1) {
      const used = facts.filter((f) => new RegExp(`\\{\\{\\s*${f.key}\\s*\\}\\}`).test(template.body + template.subject));
      drafts.push({ subject: fillTemplate(template.subject, vars), body: fillTemplate(template.body, vars), used, generator: `template:${template.id}` });
      continue;
    }
    const d = await draftStep({ auth, channel, step, previous: drafts[step - 2]?.body ?? null, facts, role, company: org.name });
    if (d.fallback) notice = d.fallback;
    drafts.push(d);
  }

  await db.outreachSequence.deleteMany({ where: { applicationId, orgId: auth.orgId, status: "draft" } });
  const seq = await db.outreachSequence.create({
    data: {
      orgId: auth.orgId,
      applicationId,
      channel,
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
  await event(auth.orgId, seq.id, "drafted", auth.userName, { note: `${channel === "whatsapp" ? "WhatsApp" : "Email"} · first message + ${followUps} follow-ups` });
  await audit(auth, "outreach.drafted", { subjectType: "outreach", subjectId: seq.id, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { steps, channel, ai: drafts.some((d) => d.generator.startsWith("ai:")) } });
  refresh(app.candidateId);
  return { ok: true, message: notice ?? `Drafted a first message and ${followUps} follow-ups. Review, edit and approve each one.` };
}

/** Redrafts one unsent step. It returns to draft and must be approved again. */
export async function regenerateMessage(messageId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const m = await ownMessage(auth, messageId);
  if (!m) return { error: "Message not found." };
  if (m.sentAt) return { error: "This message was already sent." };
  if (!["draft", "paused"].includes(m.sequence.status)) return { error: "Pause the sequence before regenerating." };
  const { org, role, facts } = await draftContext(auth, m.applicationId);
  const prev = m.step > 1 ? await db.outreachMessage.findFirst({ where: { sequenceId: m.sequenceId, step: m.step - 1 }, select: { body: true } }) : null;
  const d = await draftStep({ auth, channel: m.sequence.channel === "whatsapp" ? "whatsapp" : "email", step: m.step, previous: prev?.body ?? null, facts, role, company: org.name });
  const body = d.body + OPT_OUT_FOOTER;
  await db.outreachMessage.update({
    where: { id: messageId },
    data: { subject: d.subject, body, draftSubject: d.subject, draftBody: body, personalizationJson: JSON.stringify(d.used), generator: d.generator, status: "draft", approvedByName: null, approvedAt: null },
  });
  await event(auth.orgId, m.sequenceId, "regenerated", auth.userName, { messageId, note: `Step ${m.step}` });
  refresh(m.sequence.application.candidateId);
  return { ok: true, message: d.fallback ?? `Step ${m.step} redrafted — approve it again before activating` };
}

/** Approves every unsent draft step in a sequence the recruiter has reviewed. */
export async function approveAll(sequenceId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const seq = await ownSequence(auth, sequenceId);
  if (!seq) return { error: "Sequence not found." };
  const drafts = seq.messages.filter((m) => m.status === "draft" && !m.sentAt);
  if (!drafts.length) return { ok: true };
  await db.outreachMessage.updateMany({ where: { id: { in: drafts.map((m) => m.id) } }, data: { status: "approved", approvedByName: auth.userName, approvedAt: new Date() } });
  for (const m of drafts) await event(auth.orgId, sequenceId, "approved", auth.userName, { messageId: m.id });
  await audit(auth, "outreach.approved", { subjectType: "outreach", subjectId: sequenceId, candidateId: seq.application.candidateId, roleId: seq.application.roleId, applicationId: seq.applicationId, meta: { steps: drafts.length } });
  refresh(seq.application.candidateId);
  return { ok: true };
}

/** Edits a message. Any change after approval returns it to draft so it must be re-approved. */
export async function updateMessage(messageId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const m = await ownMessage(auth, messageId);
  if (!m) return { error: "Message not found." };
  if (m.sentAt) return { error: "This message was already sent." };
  if (!["draft", "paused"].includes(m.sequence.status)) return { error: "Pause the sequence before editing." };
  const subject = str(fd, "subject", 200) || (m.sequence.channel === "whatsapp" ? "WhatsApp" : "");
  const body = str(fd, "body", 6000);
  const delayDays = Math.min(30, Math.max(0, Number(str(fd, "delayDays")) || m.delayDays));
  if (!body || (!subject && m.sequence.channel !== "whatsapp")) return { error: "Subject and message can't be empty." };
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
/**
 * The recruiter's approval to send. Gated per channel: contact details on file, no opt-out, every
 * step approved; WhatsApp also needs a connected provider and a recorded WhatsApp opt-in.
 * With a provider connected, the first message goes out right away; follow-ups follow their delays.
 */
export async function activateSequence(sequenceId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const seq = await ownSequence(auth, sequenceId);
  if (!seq) return { error: "Sequence not found." };
  const c = seq.application.candidate;
  if (c.isSample) return { error: "This is a fictional sample person — there is no one to contact." };
  if (c.contactOptOut) return { error: "The candidate opted out. Outreach is blocked." };
  if (seq.channel === "whatsapp") {
    if (!whatsappConfigured()) return { error: "WhatsApp isn't connected. Sending stays disabled until an admin sets it up." };
    if (!waNumber(c.phone)) return { error: "No phone number with a country code on file. Talyn never guesses contact details." };
    if (c.whatsappPermission !== "granted") return { error: "Record the candidate's WhatsApp opt-in before sending on WhatsApp." };
  } else if (!c.email) return { error: "No email address on file. Add one in Edit profile — Talyn never guesses contact details." };
  if (seq.messages.some((m) => m.status === "draft")) return { error: "Approve every message first." };
  if (!["draft", "paused"].includes(seq.status)) return { error: "This sequence can't be activated." };
  const now = new Date();
  const first = seq.messages.find((m) => !m.sentAt);
  await db.$transaction([
    db.outreachSequence.update({ where: { id: sequenceId }, data: { status: "active", stopReason: null, activatedByName: auth.userName, activatedAt: now } }),
    ...(first && !first.dueAt ? [db.outreachMessage.update({ where: { id: first.id }, data: { dueAt: now } })] : []),
  ]);
  await event(auth.orgId, sequenceId, seq.status === "paused" ? "resumed" : "activated", auth.userName);
  await audit(auth, "outreach.activated", { subjectType: "outreach", subjectId: sequenceId, candidateId: c.id, roleId: seq.application.roleId, applicationId: seq.applicationId, meta: { steps: seq.messages.length, channel: seq.channel } });
  const providerOn = seq.channel === "whatsapp" ? whatsappConfigured() : !!getEmailProvider();
  let message = providerOn ? "Activated." : "Activated. Email sending isn't connected — send each due message from your own mail client and record it.";
  if (providerOn) {
    const r = await sendDueMessages({ orgId: auth.orgId, sequenceId, limit: 1, triggeredBy: auth.userName }).catch(() => null);
    message = r?.sent ? "Activated — the first message was sent. Follow-ups go out on their delays unless the candidate replies, declines or opts out." : r?.failed ? "Activated, but the provider didn't accept the first message. It will retry on the next run." : "Activated.";
  }
  refresh(c.id);
  return { ok: true, message };
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
export async function recordOutcome(sequenceId: string, type: "replied" | "declined" | "opted_out" | "bounced", note?: string): Promise<ActionState> {
  const auth = await requireAuth();
  const seq = await ownSequence(auth, sequenceId);
  if (!seq) return { error: "Sequence not found." };
  const t = z.enum(["replied", "declined", "opted_out", "bounced"]).parse(type);
  await applyOutcome({ orgId: auth.orgId, userId: auth.userId, userName: auth.userName, providerConfirmed: false }, sequenceId, t, { note });
  refresh(seq.application.candidateId);
  return { ok: true };
}

/** Admin: send due messages now instead of waiting for the scheduled run. Only with a provider. */
export async function sendDueNow(): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only workspace admins can do this." };
  const r = await sendDueMessages({ orgId: auth.orgId, triggeredBy: auth.userName });
  if (!r) return { error: "No email provider is connected." };
  revalidatePath("/queue");
  revalidatePath("/integrations");
  return { ok: true, message: r.due ? `${r.sent} sent${r.skipped ? ` · ${r.skipped} skipped (opt-out, no email or no longer active)` : ""}${r.failed ? ` · ${r.failed} failed, will retry` : ""}.` : "Nothing is due." };
}

/** Admin: sends one test email to the admin's own address to check SMTP settings. */
export async function sendTestEmail(): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only workspace admins can do this." };
  const provider = getEmailProvider();
  if (!provider) return { error: "No email provider is connected." };
  const me = await db.user.findUnique({ where: { id: auth.userId }, select: { email: true } });
  if (!me?.email) return { error: "Your account has no email address." };
  try {
    await provider.send({ to: me.email, from: process.env.OUTREACH_FROM_EMAIL!, replyTo: process.env.OUTREACH_REPLY_TO || undefined, subject: "Talyn test email", text: "This is a test from Talyn In-house TA. Your email settings work." });
  } catch (err) {
    logError("outreach.test_failed", err);
    return { error: "The mail server didn't accept the test message. Check SMTP host, port, user, password and sender address." };
  }
  await audit(auth, "outreach.test_sent", { subjectType: "org", subjectId: auth.orgId });
  return { ok: true, message: "Test email sent to your address." };
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
