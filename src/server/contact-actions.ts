"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionState } from "./form";
import { ownApplication, ownCandidate } from "./scope";

const refresh = (candidateId: string, roleId?: string) => {
  revalidatePath(`/candidates/${candidateId}`);
  if (roleId) revalidatePath(`/roles/${roleId}/discover`);
};

/**
 * Records the candidate's WhatsApp permission. "Granted" needs a note of how and when the
 * candidate opted in (e.g. "Asked to continue on WhatsApp in their email reply on 3 Oct").
 */
export async function setWhatsappPermission(candidateId: string, status: "granted" | "withdrawn", note: string): Promise<ActionState> {
  const auth = await requireAuth();
  const c = await ownCandidate(auth, candidateId);
  const s = z.enum(["granted", "withdrawn"]).parse(status);
  const n = note.trim().slice(0, 500);
  if (s === "granted" && n.length < 8) return { error: "Describe how the candidate opted in to WhatsApp (when and how)." };
  if (s === "granted" && c.contactOptOut) return { error: "The candidate opted out of all contact." };
  await db.candidate.update({ where: { id: candidateId }, data: { whatsappPermission: s, whatsappPermissionAt: new Date(), whatsappPermissionNote: n || null, whatsappPermissionBy: auth.userName } });
  if (s === "withdrawn") {
    // Stop any live WhatsApp sequence for this person.
    const live = await db.outreachSequence.findMany({ where: { orgId: auth.orgId, channel: "whatsapp", status: { in: ["active", "paused"] }, application: { candidateId } }, select: { id: true } });
    for (const q of live) {
      await db.$transaction([
        db.outreachSequence.update({ where: { id: q.id }, data: { status: "stopped", stopReason: "permission_withdrawn" } }),
        db.outreachMessage.updateMany({ where: { sequenceId: q.id, sentAt: null }, data: { status: "cancelled", dueAt: null } }),
        db.outreachEvent.create({ data: { orgId: auth.orgId, sequenceId: q.id, type: "stopped", actorName: auth.userName, note: "WhatsApp permission withdrawn" } }),
      ]);
    }
  }
  await audit(auth, "whatsapp.permission", { subjectType: "candidate", subjectId: candidateId, candidateId, meta: { status: s } });
  refresh(candidateId);
  return { ok: true };
}

/** What the candidate has said about this role — recorded by a recruiter, never inferred. */
export async function setInterest(applicationId: string, interest: string, note: string): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const v = z.enum(["not_expressed", "interested", "not_now", "declined"]).safeParse(interest);
  if (!v.success) return { error: "Choose what the candidate said." };
  await db.application.update({
    where: { id: applicationId },
    data: { interest: v.data, interestAt: new Date(), interestByName: auth.userName, interestNote: note.trim().slice(0, 500) || null },
  });
  // A decline stops follow-ups, like a recorded reply would.
  if (v.data === "declined") {
    const live = await db.outreachSequence.findMany({ where: { applicationId, status: { in: ["active", "paused", "draft"] } }, select: { id: true } });
    for (const q of live)
      await db.$transaction([
        db.outreachSequence.update({ where: { id: q.id }, data: { status: "stopped", stopReason: "declined" } }),
        db.outreachMessage.updateMany({ where: { sequenceId: q.id, sentAt: null }, data: { status: "cancelled", dueAt: null } }),
        db.outreachEvent.create({ data: { orgId: auth.orgId, sequenceId: q.id, type: "stopped", actorName: auth.userName, note: "Candidate declined" } }),
      ]);
  }
  await audit(auth, "interest.recorded", { subjectType: "application", subjectId: applicationId, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { interest: v.data } });
  refresh(app.candidateId, app.roleId);
  return { ok: true };
}
