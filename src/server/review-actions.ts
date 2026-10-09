"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECISIONS, REJECT_REASONS } from "@/lib/domain";
import type { ActionState } from "./form";
import { ownApplication } from "./scope";

const refresh = (app: { candidateId: string; roleId: string }) => {
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/roles/${app.roleId}`);
  revalidatePath(`/roles/${app.roleId}/discover`);
  revalidatePath("/queue");
};

/**
 * Shortlist / Hold / Reject from a list or card. Always a recruiter action; the pipeline stage
 * is not changed. Reject requires a job-related reason.
 */
export async function setDecision(applicationId: string, decision: string, input: { reason?: string; note?: string } = {}): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const d = z.enum(DECISIONS).safeParse(decision);
  if (!d.success) return { error: "Choose Shortlist, Hold or Reject." };
  const reason = input.reason?.trim() || null;
  const note = input.note?.trim().slice(0, 4000) || null;
  if (d.data === "decline") {
    if (!reason || !REJECT_REASONS.some((r) => r.value === reason)) return { error: "Choose a reason for rejecting." };
    if (reason === "other" && !note) return { error: "Add a short note explaining the reason." };
  }
  await db.application.update({
    where: { id: applicationId },
    data: {
      decision: d.data,
      decisionReason: d.data === "decline" ? reason : null,
      decisionNote: note ?? (d.data === app.decision ? app.decisionNote : null),
      decidedById: auth.userId,
      decidedByName: auth.userName,
      decidedAt: new Date(),
    },
  });
  await audit(auth, "decision.recorded", { subjectType: "application", subjectId: applicationId, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { decision: d.data, reason } });
  refresh(app);
  return { ok: true };
}

/** Clears the recruiter decision (e.g. "Remove from shortlist"). Nothing else changes. */
export async function clearDecision(applicationId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  await db.application.update({ where: { id: applicationId }, data: { decision: null, decisionReason: null, decisionNote: null, decidedById: null, decidedByName: null, decidedAt: null } });
  await audit(auth, "decision.cleared", { subjectType: "application", subjectId: applicationId, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { previous: app.decision } });
  refresh(app);
  return { ok: true };
}
