"use server";

import { revalidatePath } from "next/cache";
import { AiRequestError, AiUnavailableError, aiStatus, draftInfoRequestWithAi } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import { getEmailProvider } from "@/lib/outreach/provider";
import { sendWhatsAppTemplate, sendWhatsAppText, templateCarriesMessage, waNumber, whatsappConfigured } from "@/lib/outreach/whatsapp";
import type { ActionState } from "./form";
import { assessApplication } from "./assessment-engine";

type Channel = "whatsapp" | "email";

async function ownTask(orgId: string, id: string) {
  return db.task.findFirst({
    where: { id, orgId, type: "gather_info" },
    include: {
      application: {
        include: {
          role: { select: { title: true } },
          candidate: { select: { id: true, fullName: true, email: true, phone: true, contactOptOut: true, isSample: true, whatsappPermission: true, candidateSummary: true } },
        },
      },
    },
  });
}
type T = NonNullable<Awaited<ReturnType<typeof ownTask>>>;

/** Everything that must be true before Talyn may contact the candidate on this channel. */
function blockers(t: T, channel: Channel): string[] {
  const c = t.application.candidate;
  const out: string[] = [];
  if (c.isSample) out.push("This is a fictional sample person.");
  if (c.contactOptOut) out.push("The candidate opted out of contact.");
  if (channel === "whatsapp") {
    if (!waNumber(c.phone)) out.push("No phone number with a country code (e.g. +91…) on file.");
    if (c.whatsappPermission !== "granted") out.push("No WhatsApp opt-in recorded — record it on the Outreach tab first.");
  } else if (!c.email) out.push("No email address on file.");
  return out;
}

const refresh = (t: T) => {
  revalidatePath(`/candidates/${t.application.candidateId}`);
  revalidatePath("/queue");
  revalidatePath("/home");
};

/** Step 1 — the assistant drafts the message from the request's questions. Nothing is sent. */
export async function draftFollowUp(taskId: string, channel: Channel): Promise<ActionState> {
  const auth = await requireAuth();
  const t = await ownTask(auth.orgId, taskId);
  if (!t || t.status !== "open") return { error: "This request is no longer open." };
  const b = blockers(t, channel);
  if (b.length) return { error: b.join(" ") };
  const questions = ((JSON.parse(t.detailsJson) as { questions?: string[] }).questions ?? []).filter(Boolean);
  if (!questions.length) return { error: "Add at least one question to the request first." };
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { name: true } });
  const firstName = t.application.candidate.fullName.split(/\s+/)[0];
  let subject = `A few questions about your ${t.application.role.title} application`;
  let body = `Hi ${firstName},\n\nThanks for your interest in the ${t.application.role.title} role at ${org.name}. To help the team understand your experience, could you answer a few questions?\n\n${questions.map((q, i) => `${i + 1}. ${q}`).join("\n")}\n\nThank you,\n${auth.userName}`;
  let draftedBy = "template";
  const ai = aiStatus();
  if (ai.configured) {
    try {
      const r = await draftInfoRequestWithAi({ channel, firstName, roleTitle: t.application.role.title, company: org.name, recruiter: auth.userName, questions });
      subject = r.subject.slice(0, 200) || subject;
      body = r.body.slice(0, 4000) || body;
      draftedBy = `ai:${ai.provider}:${ai.model}`;
    } catch (err) {
      if (!(err instanceof AiUnavailableError || err instanceof AiRequestError)) logError("task.draft_failed", err, { taskId });
    }
  }
  await db.task.update({ where: { id: taskId }, data: { agentStatus: "drafted", agentChannel: channel, agentSubject: subject, agentDraft: body, agentDraftedBy: draftedBy, agentError: null } });
  await audit(auth, "task.followup_drafted", { subjectType: "application", subjectId: taskId, candidateId: t.application.candidateId, roleId: t.application.roleId, applicationId: t.applicationId, meta: { channel, draftedBy } });
  refresh(t);
  return { ok: true, message: "Draft ready — review and approve it before anything is sent." };
}

export async function saveFollowUpDraft(taskId: string, subject: string, body: string): Promise<ActionState> {
  const auth = await requireAuth();
  const t = await ownTask(auth.orgId, taskId);
  if (!t || t.agentStatus !== "drafted") return { error: "There's no draft to edit." };
  if (!body.trim()) return { error: "The message can't be empty." };
  await db.task.update({ where: { id: taskId }, data: { agentSubject: subject.slice(0, 200), agentDraft: body.slice(0, 4000) } });
  refresh(t);
  return { ok: true, message: "Draft saved" };
}

export async function discardFollowUp(taskId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const t = await ownTask(auth.orgId, taskId);
  if (!t) return { error: "Not found." };
  await db.task.update({ where: { id: taskId }, data: { agentStatus: null, agentChannel: null, agentSubject: null, agentDraft: null, agentDraftedBy: null, agentError: null } });
  refresh(t);
  return { ok: true, message: "Draft discarded" };
}

/** Within WhatsApp's 24-hour customer-service window (the candidate messaged us recently)? */
async function inWhatsAppWindow(t: T) {
  const since = new Date(Date.now() - 24 * 3600 * 1000);
  const [task, ev] = await Promise.all([
    db.task.count({ where: { orgId: t.orgId, applicationId: t.applicationId, agentReplyVia: "WhatsApp", agentReplyAt: { gte: since } } }),
    db.outreachEvent.count({ where: { orgId: t.orgId, type: "replied", actorName: "WhatsApp", createdAt: { gte: since }, sequence: { application: { candidateId: t.application.candidateId } } } }),
  ]);
  return task + ev > 0;
}

/** Step 2 — the recruiter approves; Talyn sends through the connected provider and records what the provider confirms. */
export async function approveAndSendFollowUp(taskId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const t = await ownTask(auth.orgId, taskId);
  if (!t || t.agentStatus !== "drafted" || !t.agentDraft || !t.agentChannel) return { error: "There's no approved-ready draft." };
  const channel = t.agentChannel as Channel;
  const b = blockers(t, channel);
  if (b.length) return { error: b.join(" ") };
  const c = t.application.candidate;
  try {
    let providerId = "";
    let via = "";
    let to = "";
    if (channel === "whatsapp") {
      if (!whatsappConfigured()) return { error: "WhatsApp isn't connected. Send it yourself and use “Mark as sent”, or connect WhatsApp in Integrations." };
      to = waNumber(c.phone)!;
      if (templateCarriesMessage()) {
        const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { name: true } });
        providerId = (await sendWhatsAppTemplate(to, { first_name: c.fullName.split(/\s+/)[0], role_title: t.application.role.title, company: org.name, recruiter_name: auth.userName, message: t.agentDraft })).providerMessageId;
      } else if (await inWhatsAppWindow(t)) {
        providerId = (await sendWhatsAppText(to, t.agentDraft)).providerMessageId;
      } else
        return {
          error:
            "WhatsApp only allows a free-text message within 24 hours of the candidate's last message. Add a “message” parameter to your approved template (WHATSAPP_TEMPLATE_PARAMS), send by email, or send it yourself and use “Mark as sent”.",
        };
      via = "WhatsApp Business Platform";
    } else {
      const email = getEmailProvider();
      if (!email) return { error: "Email sending isn't connected. Send it yourself and use “Mark as sent”, or connect SMTP in Integrations." };
      to = c.email!;
      providerId = (await email.send({ to, from: process.env.OUTREACH_FROM_EMAIL!, replyTo: process.env.OUTREACH_REPLY_TO || undefined, subject: t.agentSubject || "A few questions", text: t.agentDraft })).providerMessageId;
      via = email.label;
    }
    await db.task.update({ where: { id: taskId }, data: { agentStatus: "sent", agentApprovedBy: auth.userName, agentSentAt: new Date(), agentSentVia: via, agentProviderId: providerId || null, agentTo: to, agentError: null } });
    await audit(auth, "task.followup_sent", { subjectType: "application", subjectId: taskId, candidateId: c.id, roleId: t.application.roleId, applicationId: t.applicationId, meta: { channel, provider: via } });
    refresh(t);
    return { ok: true, message: `Sent — accepted by ${channel === "whatsapp" ? "WhatsApp" : "the mail server"}. The reply will show here when the provider reports it.` };
  } catch (err) {
    logError("task.followup_send_failed", err, { taskId, channel });
    await db.task.update({ where: { id: taskId }, data: { agentError: "The provider didn't accept the message. Nothing was sent. Check Integrations, then try again." } });
    refresh(t);
    return { error: "The provider didn't accept the message. Nothing was sent." };
  }
}

/** When there's no provider: the recruiter sent it themselves and records that. */
export async function markFollowUpSent(taskId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const t = await ownTask(auth.orgId, taskId);
  if (!t || t.agentStatus !== "drafted" || !t.agentChannel) return { error: "There's no draft to mark as sent." };
  const b = blockers(t, t.agentChannel as Channel);
  if (b.length) return { error: b.join(" ") };
  const c = t.application.candidate;
  await db.task.update({
    where: { id: taskId },
    data: { agentStatus: "sent", agentApprovedBy: auth.userName, agentSentAt: new Date(), agentSentVia: "manual", agentTo: t.agentChannel === "whatsapp" ? waNumber(c.phone) : c.email },
  });
  await audit(auth, "task.followup_sent", { subjectType: "application", subjectId: taskId, candidateId: c.id, roleId: t.application.roleId, applicationId: t.applicationId, meta: { channel: t.agentChannel, provider: "manual" } });
  refresh(t);
  return { ok: true, message: "Recorded as sent by you." };
}

export async function markFollowUpReplied(taskId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const t = await ownTask(auth.orgId, taskId);
  if (!t || t.agentStatus !== "sent") return { error: "Nothing is waiting for a reply." };
  await db.task.update({ where: { id: taskId }, data: { agentStatus: "replied", agentReplyAt: new Date(), agentReplyVia: `recruiter (${auth.userName})` } });
  refresh(t);
  return { ok: true, message: "Reply recorded" };
}

/**
 * Step 3 — the recruiter records the candidate's answers. They're added to the candidate's
 * candidate-provided information (labelled with channel and date) so they count as evidence;
 * optionally reassess right away. The request is closed; no decision is recorded.
 */
export async function recordFollowUpAnswers(taskId: string, answers: string, reassess: boolean): Promise<ActionState> {
  const auth = await requireAuth();
  const t = await ownTask(auth.orgId, taskId);
  if (!t || t.status !== "open") return { error: "This request is no longer open." };
  const text = answers.trim().slice(0, 6000);
  if (text.length < 5) return { error: "Paste or summarise what the candidate said." };
  const c = t.application.candidate;
  const when = new Date().toLocaleDateString("en-US", { day: "numeric", month: "short", year: "numeric" });
  const label = `Candidate's answers (${t.agentChannel === "whatsapp" ? "WhatsApp" : t.agentChannel === "email" ? "email" : "conversation"}, ${when}, recorded by ${auth.userName}):`;
  await db.$transaction([
    db.candidate.update({ where: { id: c.id }, data: { candidateSummary: [c.candidateSummary?.trim(), `${label}\n${text}`].filter(Boolean).join("\n\n") } }),
    db.task.update({ where: { id: taskId }, data: { agentStatus: "answered", status: "done", resolvedAt: new Date(), resolvedByName: auth.userName, resolvedNote: "Candidate answered; added to candidate-provided information." } }),
  ]);
  await audit(auth, "task.followup_answered", { subjectType: "application", subjectId: taskId, candidateId: c.id, roleId: t.application.roleId, applicationId: t.applicationId, meta: { reassess } });
  let msg = "Answers added to the candidate's provided information.";
  if (reassess) {
    const r = await assessApplication(auth, t.applicationId, aiStatus().configured ? "ai" : "keyword");
    msg += r.ok ? " Reassessed with the new answers — check the updated evidence and score." : ` Reassessment didn't run: ${r.error}`;
  }
  refresh(t);
  revalidatePath(`/roles/${t.application.roleId}`);
  return { ok: true, message: msg };
}
