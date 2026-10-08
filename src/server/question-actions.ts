"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, QUESTIONS_ENGINE_VERSION, aiStatus, generateCoreQuestionsWithAi, generateFollowUpsWithAi } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { RESULT_LABEL, type AssessmentResult } from "@/lib/domain";
import { locateQuote, parseEvidence } from "@/lib/evidence";
import { logError } from "@/lib/log";
import { str, type ActionState } from "./form";
import { ownApplication, ownRole } from "./scope";

/** Core questions: one consistent set per role (same for every candidate). Proposed until approved. */
export async function generateCoreQuestions(roleId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const role = await ownRole(auth, roleId);
  const criteria = await db.criterion.findMany({ where: { roleId, orgId: auth.orgId, status: "approved" }, orderBy: { position: "asc" } });
  if (!criteria.length) return { error: "Approve criteria first." };
  const ai = aiStatus();
  let rows: { criterionId: string; criterionName: string; text: string; rationale: string; origin: string; generator: string }[];
  let notice: string | undefined;
  try {
    if (!ai.configured) throw new AiUnavailableError();
    const r = await generateCoreQuestionsWithAi({ roleTitle: role.title, criteria: criteria.map((c) => ({ id: c.id, name: c.name, description: c.description, importance: c.importance })) });
    const byId = new Map(criteria.map((c) => [c.id, c]));
    rows = r.questions
      .filter((q) => byId.has(q.criterion_id))
      .map((q) => ({ criterionId: q.criterion_id, criterionName: byId.get(q.criterion_id)!.name, text: q.question.slice(0, 500), rationale: q.why.slice(0, 500), origin: "ai", generator: `ai:${ai.provider}:${ai.model}/${QUESTIONS_ENGINE_VERSION}` }));
  } catch (err) {
    if (!(err instanceof AiUnavailableError || err instanceof AiRequestError)) logError("questions.core_failed", err, { roleId });
    notice = "AI unavailable — starting questions use a simple template. Edit them before approving.";
    rows = criteria.map((c) => ({
      criterionId: c.id,
      criterionName: c.name,
      text: `Can you walk me through your experience with ${c.name.charAt(0).toLowerCase()}${c.name.slice(1)}? What did you do, and what was the outcome?`,
      rationale: `Covers the ${c.importance} criterion “${c.name}”.`,
      origin: "template",
      generator: "template:core-v1",
    }));
  }
  await db.question.deleteMany({ where: { roleId, orgId: auth.orgId, kind: "core", status: "proposed" } });
  await db.question.createMany({ data: rows.map((r) => ({ ...r, orgId: auth.orgId, roleId, kind: "core", createdByName: auth.userName })) });
  await audit(auth, "questions.generated", { subjectType: "role", subjectId: roleId, roleId, meta: { kind: "core", count: rows.length } });
  revalidatePath(`/roles/${roleId}`);
  return { ok: true, message: notice ?? `${rows.length} core questions proposed — review and approve them.` };
}

/** Candidate-specific follow-ups from evidence gaps in the latest assessment. Proposed until approved. */
export async function generateFollowUps(applicationId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const [role, assessment, resume] = await Promise.all([
    db.role.findFirstOrThrow({ where: { id: app.roleId, orgId: auth.orgId } }),
    db.assessment.findFirst({ where: { applicationId, orgId: auth.orgId }, orderBy: { createdAt: "desc" }, include: { items: true } }),
    db.resume.findFirst({ where: { candidateId: app.candidateId, orgId: auth.orgId, isCurrent: true } }),
  ]);
  if (!assessment) return { error: "Run an assessment first — follow-ups are based on its gaps." };
  const gaps = assessment.items.filter((i) => (i.overrideResult ?? i.result) !== "supported" && i.criterionId);
  if (!gaps.length) return { ok: true, message: "Every criterion is supported — the core questions cover this candidate." };
  const pages = resume ? (JSON.parse(resume.pagesJson) as string[]) : [];
  const ai = aiStatus();
  let rows: { criterionId: string; criterionName: string; text: string; rationale: string; evidenceJson: string; origin: string; generator: string }[];
  let notice: string | undefined;
  try {
    if (!ai.configured) throw new AiUnavailableError();
    const r = await generateFollowUpsWithAi({
      roleTitle: role.title,
      items: gaps.map((g) => ({
        criterionId: g.criterionId!,
        name: g.criterionName,
        result: RESULT_LABEL[(g.overrideResult ?? g.result) as AssessmentResult],
        explanation: g.explanation,
        missingInfo: g.missingInfo,
        quotes: parseEvidence(g.evidenceJson).map((e) => e.quote),
      })),
    });
    const byId = new Map(gaps.map((g) => [g.criterionId!, g]));
    rows = r.questions
      .filter((q) => byId.has(q.criterion_id))
      .slice(0, 6)
      .map((q) => {
        const g = byId.get(q.criterion_id)!;
        const loc = q.quote ? locateQuote({ resumePages: pages, profileText: "" }, q.quote, "resume") : null;
        return {
          criterionId: q.criterion_id,
          criterionName: g.criterionName,
          text: q.question.slice(0, 500),
          rationale: q.why.slice(0, 500),
          // Keep the quote only if it's really in the CV; otherwise anchor to the gap.
          evidenceJson: JSON.stringify(loc?.verified ? { quote: loc.quote, page: loc.page ?? null } : { gap: g.missingInfo || RESULT_LABEL[(g.overrideResult ?? g.result) as AssessmentResult] }),
          origin: "ai",
          generator: `ai:${ai.provider}:${ai.model}/${QUESTIONS_ENGINE_VERSION}`,
        };
      });
  } catch (err) {
    if (!(err instanceof AiUnavailableError || err instanceof AiRequestError)) logError("questions.followup_failed", err, { applicationId });
    notice = "AI unavailable — follow-ups use a simple template based on each gap.";
    rows = gaps.slice(0, 6).map((g) => ({
      criterionId: g.criterionId!,
      criterionName: g.criterionName,
      text: `The CV doesn't fully show “${g.criterionName}”. Can you tell me about relevant experience?`,
      rationale: `Assessment result: ${RESULT_LABEL[(g.overrideResult ?? g.result) as AssessmentResult]}.`,
      evidenceJson: JSON.stringify({ gap: g.missingInfo || "Not fully evidenced in the CV" }),
      origin: "template",
      generator: "template:follow-up-v1",
    }));
  }
  await db.question.deleteMany({ where: { applicationId, orgId: auth.orgId, kind: "follow_up", status: "proposed" } });
  await db.question.createMany({ data: rows.map((r) => ({ ...r, orgId: auth.orgId, roleId: app.roleId, applicationId, kind: "follow_up", createdByName: auth.userName })) });
  await audit(auth, "questions.generated", { subjectType: "application", subjectId: applicationId, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { kind: "follow_up", count: rows.length } });
  revalidatePath(`/candidates/${app.candidateId}`);
  return { ok: true, message: notice ?? `${rows.length} follow-up questions proposed.` };
}

export async function setQuestionStatus(id: string, status: "approved" | "rejected" | "proposed"): Promise<ActionState> {
  const auth = await requireAuth();
  const q = await db.question.findFirst({ where: { id, orgId: auth.orgId }, include: { application: true } });
  if (!q) return { error: "Question not found." };
  await db.question.update({ where: { id }, data: { status: z.enum(["approved", "rejected", "proposed"]).parse(status) } });
  revalidatePath(`/roles/${q.roleId}`);
  if (q.application) revalidatePath(`/candidates/${q.application.candidateId}`);
  return { ok: true };
}

export async function editQuestion(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const q = await db.question.findFirst({ where: { id, orgId: auth.orgId }, include: { application: true } });
  if (!q) return { error: "Question not found." };
  const text = str(fd, "text", 500);
  if (!text) return { error: "Write the question." };
  await db.question.update({ where: { id }, data: { text, origin: q.origin === "recruiter" ? "recruiter" : q.origin, status: "approved" } });
  revalidatePath(`/roles/${q.roleId}`);
  if (q.application) revalidatePath(`/candidates/${q.application.candidateId}`);
  return { ok: true };
}
