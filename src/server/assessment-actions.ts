"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { aiStatus } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { RECOMMENDATIONS, RESULTS } from "@/lib/domain";
import { logError } from "@/lib/log";
import { candidateInfoChanged } from "@/lib/skills";
import { isStale } from "@/lib/summary";
import { assessApplication } from "./assessment-engine";
import { recordProfileScore } from "./scoring-store";
import { str, type ActionState } from "./form";
import { ownApplication, ownAssessment, ownAssessmentItem, ownRole } from "./scope";

export async function runAssessment(applicationId: string, mode: "ai" | "keyword"): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const out = await assessApplication(auth, applicationId, mode);
  if (!out.ok) return { error: out.reason === "no_material" ? "Add a CV or candidate-provided information before assessing." : out.error };
  // Moving "new" candidates into review is NOT automatic: the recruiter decides pipeline moves.
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/roles/${app.roleId}`);
  return { ok: true };
}

/**
 * Recruiter-started "Reassess candidates" for a role: every applied, discovered and shortlisted
 * person whose assessment is missing or out of date (or everyone, with scope "all"). Uses AI when
 * configured, otherwise the labeled keyword check. Rejected candidates are skipped. Never changes
 * a stage, decision or visibility.
 */
export async function reassessRole(roleId: string, scope: "outdated" | "all" = "outdated"): Promise<ActionState> {
  const auth = await requireAuth();
  const role = await ownRole(auth, roleId);
  const criteria = await db.criterion.findMany({ where: { orgId: auth.orgId, roleId, status: "approved" }, select: { id: true, updatedAt: true } });
  if (!criteria.length) return { error: "Approve at least one skill or criterion first." };
  const apps = await db.application.findMany({
    // NULL-safe: "not decline" alone would also drop everyone without a decision yet.
    where: { orgId: auth.orgId, roleId, stage: { not: "rejected" }, OR: [{ decision: null }, { decision: { not: "decline" } }] },
    select: {
      id: true,
      candidate: { select: { currentTitle: true, currentCompany: true, candidateSummary: true, resumes: { where: { isCurrent: true }, select: { id: true }, take: 1 } } },
      assessments: { orderBy: { createdAt: "desc" }, take: 1, select: { criteriaSnapshot: true, criteriaVersion: true, resumeId: true, profileHash: true } },
    },
  });
  const todo = apps.filter((a) => {
    if (scope === "all") return true;
    const latest = a.assessments[0];
    if (!latest) return true;
    if (isStale(latest.criteriaSnapshot, criteria) || (latest.criteriaVersion != null && latest.criteriaVersion !== role.criteriaVersion)) return true;
    return candidateInfoChanged(latest, { resumeId: a.candidate.resumes[0]?.id ?? null, candidate: a.candidate });
  });
  if (!todo.length) return { ok: true, message: "Every candidate's assessment is already current." };

  const mode = aiStatus().configured ? "ai" : "keyword";
  const started = Date.now();
  const budgetMs = 240_000; // stay inside the page's 300 s limit; the rest can be run again
  const results: Awaited<ReturnType<typeof assessApplication>>[] = [];
  const concurrency = mode === "ai" ? 3 : 8;
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(concurrency, todo.length) }, async () => {
      while (next < todo.length && Date.now() - started < budgetMs) {
        const a = todo[next++];
        try {
          results.push(await assessApplication(auth, a.id, mode, { batch: true }));
        } catch (err) {
          logError("assessment.batch_item_failed", err, { applicationId: a.id });
          results.push({ ok: false, error: "failed", reason: "failed" });
        }
      }
    }),
  );
  const done = results.filter((r) => r.ok).length;
  const noMaterial = results.filter((r) => !r.ok && r.reason === "no_material").length;
  const failed = results.filter((r) => !r.ok && r.reason !== "no_material").length;
  const remaining = todo.length - results.length;
  await audit(auth, "assessment.batch", { subjectType: "role", subjectId: roleId, roleId, meta: { scope, generator: mode, assessed: done, noMaterial, failed, remaining } });
  revalidatePath(`/roles/${roleId}`);
  revalidatePath(`/roles/${roleId}/discover`);
  const parts = [`${done} candidate${done === 1 ? "" : "s"} reassessed${mode === "keyword" ? " with the keyword check (AI is off)" : ""}`];
  if (noMaterial) parts.push(`${noMaterial} need review — no CV, profile or source text to assess`);
  if (failed) parts.push(`${failed} failed — try again`);
  if (remaining) parts.push(`${remaining} not reached yet — run Reassess again`);
  return failed && !done ? { error: parts.join(" · ") } : { ok: true, message: parts.join(" · ") + "." };
}

export async function overrideItem(itemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const item = await ownAssessmentItem(auth, itemId);
  const result = str(fd, "overrideResult");
  const note = str(fd, "overrideNote", 2000);
  let to: string | null = null;
  if (result !== "") {
    const r = z.enum(RESULTS).safeParse(result);
    if (!r.success) return { error: "Choose an assessment." };
    if (!note) return { error: "Add a short note explaining the correction." };
    to = r.data;
  }
  return applyCorrection(auth, item, to, note || null, null);
}

/** Restores the value an earlier correction set (or the engine's original). Recorded as a new change. */
export async function restoreCorrection(correctionId: string, which: "before" | "after"): Promise<ActionState> {
  const auth = await requireAuth();
  const c = await db.assessmentCorrection.findFirst({ where: { id: correctionId, orgId: auth.orgId } });
  if (!c) return { error: "That change no longer exists." };
  const item = await ownAssessmentItem(auth, c.itemId);
  const value = which === "before" ? c.fromResult : c.toResult;
  const note = which === "before" ? c.fromNote : c.note;
  return applyCorrection(auth, item, value, `${note ? `${note} ` : ""}(restored from ${c.createdAt.toISOString().slice(0, 10)})`.trim(), c.id);
}

async function applyCorrection(
  auth: Awaited<ReturnType<typeof requireAuth>>,
  item: Awaited<ReturnType<typeof ownAssessmentItem>>,
  to: string | null,
  note: string | null,
  restoredFromId: string | null,
): Promise<ActionState> {
  const full = await db.assessmentItem.findUniqueOrThrow({ where: { id: item.id } });
  const app = await db.application.findFirst({ where: { id: item.assessment.applicationId, orgId: auth.orgId } });
  if (!app) return { error: "Application not found." };
  // The engine's result is never changed; the correction and every earlier one are kept.
  await db.$transaction([
    db.assessmentItem.update({ where: { id: item.id }, data: { overrideResult: to, overrideNote: note, overriddenBy: auth.userName, overriddenAt: new Date() } }),
    db.assessmentCorrection.create({
      data: {
        orgId: auth.orgId,
        itemId: item.id,
        assessmentId: item.assessmentId,
        applicationId: app.id,
        kind: full.kind,
        criterionName: full.criterionName,
        engineResult: full.result,
        fromResult: full.overrideResult,
        toResult: to,
        fromNote: full.overrideNote,
        note,
        restoredFromId,
        byId: auth.userId,
        byName: auth.userName,
      },
    }),
  ]);
  // A correction is a human change to the evidence, so the score is re-recorded (the earlier one is kept).
  await recordProfileScore(auth, item.assessmentId, "correction");
  await audit(auth, restoredFromId ? "assessment.correction_restored" : "assessment.corrected", {
    subjectType: "assessment",
    subjectId: item.assessmentId,
    candidateId: app.candidateId,
    roleId: app.roleId,
    applicationId: app.id,
    meta: { criterion: full.criterionName, from: full.overrideResult ?? `engine:${full.result}`, to: to ?? `engine:${full.result}` },
  });
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/roles/${app.roleId}`);
  return { ok: true };
}

export async function markReviewed(assessmentId: string) {
  const auth = await requireAuth();
  const a = await ownAssessment(auth, assessmentId);
  await db.assessment.update({ where: { id: assessmentId }, data: { status: "reviewed", reviewedById: auth.userId, reviewedByName: auth.userName, reviewedAt: new Date() } });
  const app = await db.application.findFirst({ where: { id: a.applicationId, orgId: auth.orgId } });
  await audit(auth, "assessment.reviewed", { subjectType: "assessment", subjectId: assessmentId, candidateId: app?.candidateId, roleId: app?.roleId, applicationId: a.applicationId });
  if (app) {
    revalidatePath(`/candidates/${app.candidateId}`);
    revalidatePath(`/roles/${app.roleId}`);
  }
}

export async function deleteAssessment(assessmentId: string) {
  const auth = await requireAuth();
  const a = await ownAssessment(auth, assessmentId);
  await db.assessment.delete({ where: { id: assessmentId } });
  const app = await db.application.findFirst({ where: { id: a.applicationId, orgId: auth.orgId } });
  await audit(auth, "assessment.deleted", { subjectType: "assessment", subjectId: assessmentId, candidateId: app?.candidateId, roleId: app?.roleId, applicationId: a.applicationId });
  if (app) revalidatePath(`/candidates/${app.candidateId}`);
}

/** Recruiter review of the AI recommendation: accept as is, edit (same outcome, own wording), or override. */
export async function reviewRecommendation(assessmentId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const a = await ownAssessment(auth, assessmentId);
  if (!a.recommendation) return { error: "There is no AI recommendation to review." };
  const action = str(fd, "reviewAction");
  const note = str(fd, "note", 2000);
  let finalRecommendation = a.recommendation;
  let status: "accepted" | "edited" | "overridden";
  if (action === "accept") status = "accepted";
  else if (action === "edit") {
    if (!note) return { error: "Add your wording of the rationale." };
    status = "edited";
  } else if (action === "override") {
    const r = z.enum(RECOMMENDATIONS).safeParse(str(fd, "finalRecommendation"));
    if (!r.success) return { error: "Choose the outcome you recommend instead." };
    if (!note) return { error: "Add a short, job-related reason for overriding." };
    finalRecommendation = r.data;
    status = r.data === a.recommendation ? "edited" : "overridden";
  } else return { error: "Choose accept, edit or override." };

  await db.assessment.update({
    where: { id: assessmentId },
    data: {
      recommendationStatus: status,
      finalRecommendation,
      recommendationNote: note || null,
      recommendationReviewedBy: auth.userName,
      recommendationReviewedAt: new Date(),
    },
  });
  const app = await db.application.findFirst({ where: { id: a.applicationId, orgId: auth.orgId } });
  await audit(auth, "recommendation.reviewed", { subjectType: "assessment", subjectId: assessmentId, candidateId: app?.candidateId, roleId: app?.roleId, applicationId: a.applicationId, meta: { status, recommendation: a.recommendation, final: finalRecommendation } });
  if (app) {
    revalidatePath(`/candidates/${app.candidateId}`);
    revalidatePath(`/roles/${app.roleId}`);
  }
  return { ok: true, message: "Recommendation review saved. Record your decision below." };
}
