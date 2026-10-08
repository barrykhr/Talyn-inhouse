"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { ASSESSMENT_ENGINE_VERSION, AiRequestError, AiUnavailableError, aiStatus, assessWithAi, recommendWithAi } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { RECOMMENDATIONS, RESULTS, type Evidence } from "@/lib/domain";
import { locateQuote, type SourceDoc } from "@/lib/evidence";
import { redactContact } from "@/lib/extraction";
import { keywordMatch, keywordsFor } from "@/lib/heuristics";
import { computeScore, scoreSummaryText } from "@/lib/score";
import { logError } from "@/lib/log";
import { str, type ActionState } from "./form";
import { ownApplication, ownAssessment, ownAssessmentItem } from "./scope";

/** Candidate-provided information that may be used as evidence (never recruiter notes). */
function profileText(c: { currentTitle: string | null; currentCompany: string | null; candidateSummary: string | null }) {
  return [
    c.currentTitle ? `Current title: ${c.currentTitle}` : "",
    c.currentCompany ? `Current company: ${c.currentCompany}` : "",
    c.candidateSummary ?? "",
  ]
    .filter(Boolean)
    .join("\n");
}

type ItemDraft = {
  criterionId: string;
  criterionName: string;
  importance: string;
  result: string;
  evidence: Evidence[];
  explanation: string;
  missingInfo: string;
  confidence: string | null;
};

export async function runAssessment(applicationId: string, mode: "ai" | "keyword"): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const [role, candidate, criteria, resume] = await Promise.all([
    db.role.findFirstOrThrow({ where: { id: app.roleId, orgId: auth.orgId } }),
    db.candidate.findFirstOrThrow({ where: { id: app.candidateId, orgId: auth.orgId } }),
    db.criterion.findMany({
      where: { roleId: app.roleId, orgId: auth.orgId, status: "approved" },
      orderBy: [{ importance: "asc" }, { priority: "asc" }, { position: "asc" }],
    }),
    db.resume.findFirst({ where: { candidateId: app.candidateId, orgId: auth.orgId, isCurrent: true } }),
  ]);

  if (criteria.length === 0) return { error: "This role has no approved criteria yet. Approve criteria on the role page first." };
  const doc: SourceDoc = { resumePages: resume ? (JSON.parse(resume.pagesJson) as string[]) : [], profileText: profileText(candidate) };
  if (!doc.resumePages.join("").trim() && !doc.profileText.trim())
    return { error: "Add a resume or candidate-provided information before assessing." };

  let drafts: ItemDraft[];
  if (mode === "ai") {
    try {
      const resumeText = redactContact(doc.resumePages.map((p, i) => (doc.resumePages.length > 1 ? `[Page ${i + 1}]\n${p}` : p)).join("\n\n"));
      const items = await assessWithAi({
        roleTitle: role.title,
        criteria: criteria.map((c) => ({ id: c.id, name: c.name, description: c.description, importance: c.importance })),
        resumeText,
        profileText: redactContact(doc.profileText),
      });
      const byId = new Map(items.map((i) => [i.criterion_id, i]));
      drafts = criteria.map((c) => {
        const it = byId.get(c.id);
        if (!it)
          return {
            criterionId: c.id,
            criterionName: c.name,
            importance: c.importance,
            result: "not_stated",
            evidence: [],
            explanation: "The AI did not return an assessment for this criterion.",
            missingInfo: "Review manually.",
            confidence: "low",
          };
        const evidence = it.evidence.filter((e) => e.quote.trim()).map((e) => locateQuote(doc, e.quote, e.source));
        let result = it.result as string;
        let confidence = it.confidence as string;
        let explanation = it.explanation;
        // A "supported" or "partially supported" claim must rest on at least one quote that exists in the material.
        if ((result === "supported" || result === "partially_supported") && !evidence.some((e) => e.verified)) {
          const was = result === "supported" ? "supported" : "partially supported";
          result = "inferred";
          confidence = "low";
          explanation = `${explanation} [Talyn: the quoted evidence could not be found verbatim in the candidate's material, so this was downgraded from "${was}" to "inferred". Verify before relying on it.]`;
        }
        return { criterionId: c.id, criterionName: c.name, importance: c.importance, result, evidence, explanation, missingInfo: it.missing_info, confidence };
      });
    } catch (err) {
      if (err instanceof AiUnavailableError || err instanceof AiRequestError) return { error: err.message };
      logError("assessment.ai_failed", err, { applicationId });
      return { error: "The assessment could not be completed. Please try again." };
    }
  } else {
    const allText = [...doc.resumePages, doc.profileText].join("\n");
    drafts = criteria.map((c) => {
      const kws = keywordsFor(c.name, c.description);
      const hits = keywordMatch(kws, allText);
      if (hits.length === 0)
        return {
          criterionId: c.id,
          criterionName: c.name,
          importance: c.importance,
          result: "not_stated",
          evidence: [],
          explanation: `No lines matched the keywords: ${kws.join(", ") || "(none)"}.`,
          missingInfo: "Keyword checks miss synonyms and context. Read the resume or ask the candidate.",
          confidence: null,
        };
      return {
        criterionId: c.id,
        criterionName: c.name,
        importance: c.importance,
        // Keyword overlap is never treated as proof; a recruiter must confirm.
        result: "inferred",
        evidence: hits.map((h) => locateQuote(doc, h.snippet, "resume")),
        explanation: `Keyword match on: ${Array.from(new Set(hits.flatMap((h) => h.matched))).join(", ")}. Check the context — a keyword match does not confirm the criterion.`,
        missingInfo: "",
        confidence: "low",
      };
    });
  }

  // Score is computed by Talyn (deterministic), then the AI is asked for a recommendation
  // that is shown AFTER the score and evidence. A recommendation failure never loses the assessment.
  const score = computeScore(drafts.map((d) => ({ name: d.criterionName, importance: d.importance, result: d.result })));
  let recommendation: string | null = null;
  let recommendationJson: Record<string, unknown> | null = null;
  if (mode === "ai") {
    try {
      const rec = await recommendWithAi({
        roleTitle: role.title,
        items: drafts.map((d) => ({ name: d.criterionName, importance: d.importance, result: d.result, explanation: d.explanation, missingInfo: d.missingInfo })),
        scoreSummary: scoreSummaryText(score),
      });
      recommendation = rec.recommendation;
      let adjustedNote: string | null = null;
      // Guardrail: never suggest advancing when Talyn has withheld the score for lack of evidence.
      if (rec.recommendation === "advance_to_review" && score.status === "withheld") {
        recommendation = "gather_more_info";
        adjustedNote = "The AI suggested advancing, but Talyn changed this to “Gather more information” because the score is withheld for incomplete evidence.";
      }
      recommendationJson = { rationale: rec.rationale, criteriaCited: rec.criteria_cited, questions: rec.questions, adjustedNote };
    } catch (err) {
      if (!(err instanceof AiRequestError)) logError("assessment.recommend_failed", err, { applicationId });
      recommendationJson = { unavailable: `The recommendation couldn't be generated${err instanceof AiRequestError ? ` (${err.message})` : ""}. The assessment and score are unaffected.` };
    }
  } else {
    recommendationJson = { unavailable: "Recommendations are only generated with AI assessments." };
  }
  const ai = aiStatus();

  await db.assessment.create({
    data: {
      orgId: auth.orgId,
      applicationId,
      resumeId: resume?.id ?? null,
      generator: mode,
      model: mode === "ai" ? `${ai.provider}:${ai.model}` : null,
      criteriaSnapshot: JSON.stringify(criteria.map((c) => ({ id: c.id, updatedAt: c.updatedAt.toISOString() }))),
      criteriaVersion: role.criteriaVersion,
      engineVersion: mode === "ai" ? ASSESSMENT_ENGINE_VERSION : "keyword-v1 + alignment-v1",
      parserVersion: resume?.parserVersion ?? null,
      scoreJson: JSON.stringify(score),
      recommendation,
      recommendationJson: recommendationJson ? JSON.stringify(recommendationJson) : null,
      recommendationStatus: recommendation ? "pending" : null,
      createdById: auth.userId,
      items: {
        create: drafts.map((d) => ({
          criterionId: d.criterionId,
          criterionName: d.criterionName,
          importance: d.importance,
          result: d.result,
          evidenceJson: JSON.stringify(d.evidence),
          explanation: d.explanation,
          missingInfo: d.missingInfo,
          confidence: d.confidence,
        })),
      },
    },
  });
  // Moving "new" candidates into review is NOT automatic: the recruiter decides pipeline moves.
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/roles/${app.roleId}`);
  return { ok: true };
}

export async function overrideItem(itemId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const item = await ownAssessmentItem(auth, itemId);
  const result = str(fd, "overrideResult");
  const note = str(fd, "overrideNote", 2000);
  if (result === "") {
    await db.assessmentItem.update({ where: { id: itemId }, data: { overrideResult: null, overrideNote: note || null, overriddenBy: auth.userName, overriddenAt: new Date() } });
  } else {
    const r = z.enum(RESULTS).safeParse(result);
    if (!r.success) return { error: "Choose an assessment." };
    if (!note) return { error: "Add a short note explaining the correction." };
    await db.assessmentItem.update({ where: { id: itemId }, data: { overrideResult: r.data, overrideNote: note, overriddenBy: auth.userName, overriddenAt: new Date() } });
  }
  const app = await db.application.findFirst({ where: { id: item.assessment.applicationId, orgId: auth.orgId } });
  if (app) revalidatePath(`/candidates/${app.candidateId}`);
  return { ok: true };
}

export async function markReviewed(assessmentId: string) {
  const auth = await requireAuth();
  const a = await ownAssessment(auth, assessmentId);
  await db.assessment.update({ where: { id: assessmentId }, data: { status: "reviewed", reviewedById: auth.userId, reviewedByName: auth.userName, reviewedAt: new Date() } });
  const app = await db.application.findFirst({ where: { id: a.applicationId, orgId: auth.orgId } });
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
  if (app) {
    revalidatePath(`/candidates/${app.candidateId}`);
    revalidatePath(`/roles/${app.roleId}`);
  }
  return { ok: true, message: "Recommendation review saved. Record your decision below." };
}
