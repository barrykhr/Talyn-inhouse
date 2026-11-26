"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { appUrl } from "@/lib/integrations/env";
import { logError } from "@/lib/log";
import { interestMessage } from "@/lib/loop/messages";
import { newLinkToken } from "@/lib/loop/token";
import { getEmailProvider } from "@/lib/outreach/provider";

const DAYS = 30;

/** Message text for asking a found candidate about interest, without sending anything. */
export async function previewInterestCheck(applicationId: string, line: string): Promise<{ text: string } | { error: string }> {
  const auth = await requireAuth();
  const app = await db.application.findFirst({ where: { id: applicationId, orgId: auth.orgId }, include: { candidate: true, role: true } });
  if (!app) return { error: "Not found." };
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { name: true } });
  return { text: interestMessage({ candidateName: app.candidate.fullName, recruiter: auth.userName, company: app.role.clientCompanyName || org.name, roleTitle: app.role.title, location: app.role.location, line, url: `${appUrl()}/interest/…` }) };
}

/**
 * Creates a one-click interest link and either emails it (when sending is connected) or returns
 * the message for the recruiter to send themselves. Nothing is claimed as sent without the mail
 * server accepting it.
 */
export async function sendInterestCheck(applicationId: string, channel: "email" | "manual", line: string): Promise<{ ok: true; text: string; message: string } | { error: string; text?: string }> {
  const auth = await requireAuth();
  const app = await db.application.findFirst({ where: { id: applicationId, orgId: auth.orgId }, include: { candidate: true, role: true } });
  if (!app) return { error: "Not found." };
  if (app.candidate.isSample) return { error: "This is a fictional sample person — there is no one to contact." };
  if (app.candidate.contactOptOut) return { error: "This person opted out of contact." };
  if (app.interest === "interested") return { error: "They've already said they're interested." };
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { name: true } });
  const { token, hash } = newLinkToken("int");
  const text = interestMessage({ candidateName: app.candidate.fullName, recruiter: auth.userName, company: app.role.clientCompanyName || org.name, roleTitle: app.role.title, location: app.role.location, line, url: `${appUrl()}/interest/${token}` });
  if (channel === "email") {
    const provider = getEmailProvider();
    if (!provider) return { error: "Email sending isn't connected. Copy the message and send it yourself.", text };
    if (!app.candidate.email) return { error: "There's no email address on file. Copy the message and send it another way.", text };
    try {
      await provider.send({ to: app.candidate.email, from: process.env.OUTREACH_FROM_EMAIL!, replyTo: process.env.OUTREACH_REPLY_TO || undefined, subject: `${app.role.title} at ${app.role.clientCompanyName || org.name}`, text });
    } catch (err) {
      logError("interest.email_failed", err);
      return { error: "The mail server didn't accept the message. Nothing was sent.", text };
    }
  }
  await db.interestCheck.create({ data: { orgId: auth.orgId, applicationId: app.id, tokenHash: hash, message: text, sentVia: channel, sentByName: auth.userName, expiresAt: new Date(Date.now() + DAYS * 86_400_000) } });
  await audit(auth, "interest.check_sent", { subjectType: "application", subjectId: app.id, applicationId: app.id, candidateId: app.candidateId, roleId: app.roleId, meta: { via: channel } });
  revalidatePath(`/roles/${app.roleId}`);
  return { ok: true, text, message: channel === "email" ? "Sent by email (accepted by the mail server)." : "Link created. Copy the message and send it yourself; their answer is recorded when they click." };
}
