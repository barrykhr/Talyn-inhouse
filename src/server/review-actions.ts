"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECISIONS, REJECT_REASONS, STAGE_FOR_DECISION, type Stage } from "@/lib/domain";
import type { ActionState } from "./form";
import { moveStageAs } from "./pipeline";
import { ownApplication } from "./scope";

const refresh = (app: { candidateId: string; roleId: string }) => {
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/roles/${app.roleId}`);
  revalidatePath(`/roles/${app.roleId}/discover`);
  revalidatePath("/queue");
};

/**
 * Shortlist / Hold / Reject from a list or card. Always a recruiter action; the pipeline stage
 * only moves when the recruiter ticked the move in the same step. Reject requires a job-related reason.
 */
export async function setDecision(applicationId: string, decision: string, input: { reason?: string; note?: string; moveStage?: string } = {}): Promise<ActionState> {
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
  // Only when the recruiter ticked the move in the same step, and only to a stage that fits the decision.
  const to = input.moveStage as Stage | undefined;
  if (to && STAGE_FOR_DECISION[d.data].includes(to)) await moveStageAs(auth, app, to);
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

const MAX_BULK = 200;

/**
 * The same decision for several applicants the recruiter selected in a list — one recruiter action,
 * recorded and audited per application. Reject needs one job-related reason for all of them; the
 * stage moves only when "Also move to the Rejected stage" was ticked.
 */
export async function bulkDecision(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const ids = [...new Set(fd.getAll("ids").map(String).filter(Boolean))];
  if (!ids.length) return { error: "Select at least one applicant." };
  if (ids.length > MAX_BULK) return { error: `Select at most ${MAX_BULK} applicants at a time.` };
  const d = z.enum(DECISIONS).safeParse(String(fd.get("decision") ?? ""));
  if (!d.success) return { error: "Choose Shortlist, Hold or Reject." };
  const reason = String(fd.get("reason") ?? "").trim() || null;
  const note = String(fd.get("note") ?? "").trim().slice(0, 4000) || null;
  if (d.data === "decline") {
    if (!reason || !REJECT_REASONS.some((r) => r.value === reason)) return { error: "Choose a reason for rejecting." };
    if (reason === "other" && !note) return { error: "Add a short note explaining the reason." };
  }
  const moveTo = String(fd.get("moveStage") ?? "") as Stage;
  const apps = await db.application.findMany({ where: { id: { in: ids }, orgId: auth.orgId } });
  if (!apps.length) return { error: "Those applicants weren't found." };
  let moved = 0;
  for (const app of apps) {
    await db.application.update({
      where: { id: app.id },
      data: { decision: d.data, decisionReason: d.data === "decline" ? reason : null, decisionNote: note, decidedById: auth.userId, decidedByName: auth.userName, decidedAt: new Date() },
    });
    await audit(auth, "decision.recorded", { subjectType: "application", subjectId: app.id, candidateId: app.candidateId, roleId: app.roleId, applicationId: app.id, meta: { decision: d.data, reason, bulk: apps.length } });
    if (moveTo && STAGE_FOR_DECISION[d.data].includes(moveTo) && (await moveStageAs(auth, app, moveTo))) moved++;
  }
  for (const roleId of new Set(apps.map((a) => a.roleId))) {
    revalidatePath(`/roles/${roleId}`);
    revalidatePath(`/roles/${roleId}/discover`);
  }
  revalidatePath("/queue");
  const label = d.data === "advance" ? "shortlisted" : d.data === "hold" ? "put on hold" : "rejected";
  return { ok: true, message: `${apps.length} applicant${apps.length === 1 ? "" : "s"} ${label}${moved ? `, ${moved} moved to the Rejected stage` : ""}. Each is recorded in their history.` };
}
