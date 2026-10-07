"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, aiStatus, assessWithAi } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { RESULTS, type Evidence } from "@/lib/domain";
import { locateQuote, type SourceDoc } from "@/lib/evidence";
import { keywordMatch, keywordsFor } from "@/lib/heuristics";
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

/** Contact details are irrelevant to criteria, so they are not sent to the AI provider. */
function redactContact(text: string) {
  return text
    .replace(/[\w.+-]+@[\w-]+(\.[\w-]+)+/g, "[email]")
    .replace(/(?<![\w])(\+?\d[\d\s().-]{7,}\d)(?![\w])/g, (m) => (m.replace(/\D/g, "").length >= 9 ? "[phone]" : m));
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
        // A "supported" claim must rest on at least one quote that exists in the material.
        if (result === "supported" && !evidence.some((e) => e.verified)) {
          result = "inferred";
          confidence = "low";
          explanation = `${explanation} [Talyn: the quoted evidence could not be found verbatim in the candidate's material, so this was downgraded from "supported" to "inferred". Verify before relying on it.]`;
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

  await db.assessment.create({
    data: {
      orgId: auth.orgId,
      applicationId,
      resumeId: resume?.id ?? null,
      generator: mode,
      model: mode === "ai" ? aiStatus().model : null,
      criteriaSnapshot: JSON.stringify(criteria.map((c) => ({ id: c.id, updatedAt: c.updatedAt.toISOString() }))),
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
