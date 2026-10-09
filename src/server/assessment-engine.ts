import "server-only";
import { ASSESSMENT_ENGINE_VERSION, AiRequestError, AiUnavailableError, aiStatus, assessWithAi, recommendWithAi } from "@/lib/ai";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import type { Evidence } from "@/lib/domain";
import { locateQuote, type SourceDoc } from "@/lib/evidence";
import { redactContact } from "@/lib/extraction";
import { findSkillMentions, keywordMatch, keywordsFor, skillTerms } from "@/lib/heuristics";
import { logError } from "@/lib/log";
import { computeScore, scoreSummaryText, weightsOf } from "@/lib/score";
import { profileEvidenceText, profileFingerprint } from "@/lib/skills";
import { sourceLabel } from "@/lib/sourcing/connectors";

type ItemDraft = {
  criterionId: string;
  criterionName: string;
  importance: string;
  kind: string;
  result: string;
  evidence: Evidence[];
  explanation: string;
  missingInfo: string;
  confidence: string | null;
};

export type AssessOutcome = { ok: true; generator: "ai" | "keyword" } | { ok: false; error: string; reason: "no_criteria" | "no_material" | "failed" };

/** Text of the Discover source record a person was saved from, used as linked source evidence. */
async function linkedSource(orgId: string, sourcedProfileId: string | null) {
  if (!sourcedProfileId) return null;
  const p = await db.sourcedProfile.findFirst({
    where: { id: sourcedProfileId, orgId },
    select: { id: true, source: true, sourceUrl: true, retrievedAt: true, currentTitle: true, currentCompany: true, fieldsJson: true, signalsJson: true },
  });
  if (!p) return null;
  const lines: string[] = [];
  if (p.currentTitle) lines.push(`Title: ${p.currentTitle}`);
  if (p.currentCompany) lines.push(`Company: ${p.currentCompany}`);
  try {
    const fields = JSON.parse(p.fieldsJson) as Record<string, { value?: unknown }>;
    for (const [k, v] of Object.entries(fields)) {
      // Contact details are never evidence of a skill.
      if (["email", "phone", "linkedin_url"].includes(k) || typeof v?.value !== "string") continue;
      lines.push(`${k.replace(/_/g, " ")}: ${v.value}`);
    }
    const signals = JSON.parse(p.signalsJson) as { quote?: string }[];
    for (const s of signals) if (s.quote && !lines.includes(s.quote)) lines.push(s.quote);
  } catch {
    /* malformed record: use what we have */
  }
  const text = lines.join("\n").trim();
  if (!text) return null;
  return {
    id: p.id,
    text,
    meta: { origin: p.source === "sample" ? "Talyn sample data (fictional)" : sourceLabel(p.source), date: p.retrievedAt.toISOString(), url: p.sourceUrl },
  };
}

/**
 * Assesses one application against the role's approved skills and evaluation criteria, using
 * only the candidate's CV, candidate-provided information and linked source record. Stores a new
 * assessment (history is kept). Never changes a stage, decision or visibility.
 */
export async function assessApplication(auth: AuthContext, applicationId: string, mode: "ai" | "keyword", opts: { batch?: boolean } = {}): Promise<AssessOutcome> {
  const app = await db.application.findFirst({ where: { id: applicationId, orgId: auth.orgId } });
  if (!app) return { ok: false, error: "Application not found.", reason: "failed" };
  const [role, candidate, criteria, resume, source] = await Promise.all([
    db.role.findFirstOrThrow({ where: { id: app.roleId, orgId: auth.orgId } }),
    db.candidate.findFirstOrThrow({ where: { id: app.candidateId, orgId: auth.orgId } }),
    db.criterion.findMany({
      where: { roleId: app.roleId, orgId: auth.orgId, status: "approved" },
      orderBy: [{ kind: "desc" }, { importance: "asc" }, { priority: "asc" }, { position: "asc" }],
    }),
    db.resume.findFirst({ where: { candidateId: app.candidateId, orgId: auth.orgId, isCurrent: true } }),
    linkedSource(auth.orgId, app.sourcedProfileId),
  ]);

  if (criteria.length === 0) return { ok: false, error: "This role has no approved skills or criteria yet. Approve them on the role's Criteria tab first.", reason: "no_criteria" };
  const profile = profileEvidenceText(candidate);
  let pages: string[] = [];
  try {
    pages = resume ? (JSON.parse(resume.pagesJson) as string[]) : [];
  } catch {
    pages = []; // unreadable stored text is treated as no CV, never guessed
  }
  const doc: SourceDoc = {
    resumePages: pages,
    profileText: profile,
    sourceText: source?.text,
    resumeMeta: resume ? { origin: resume.fileName, date: resume.createdAt.toISOString() } : undefined,
    profileMeta: { origin: "Candidate-provided information", date: candidate.updatedAt.toISOString() },
    sourceMeta: source?.meta,
  };
  if (!doc.resumePages.join("").trim() && !doc.profileText.trim() && !doc.sourceText)
    return { ok: false, error: "No CV, candidate-provided information or linked source record to assess.", reason: "no_material" };

  let drafts: ItemDraft[];
  if (mode === "ai") {
    try {
      const resumeText = redactContact(doc.resumePages.map((p, i) => (doc.resumePages.length > 1 ? `[Page ${i + 1}]\n${p}` : p)).join("\n\n"));
      const items = await assessWithAi({
        roleTitle: role.title,
        criteria: criteria.map((c) => ({ id: c.id, name: c.name, description: c.description, importance: c.importance, kind: c.kind, aliases: c.aliases })),
        resumeText,
        profileText: redactContact(doc.profileText),
        sourceText: doc.sourceText ? redactContact(doc.sourceText) : undefined,
      });
      const byId = new Map(items.map((i) => [i.criterion_id, i]));
      drafts = criteria.map((c) => {
        const it = byId.get(c.id);
        const base = { criterionId: c.id, criterionName: c.name, importance: c.importance, kind: c.kind };
        if (!it)
          return { ...base, result: "inferred", evidence: [], explanation: "The AI did not return an assessment for this item, so it needs a recruiter's review.", missingInfo: "Review manually.", confidence: "low" };
        const evidence = it.evidence.filter((e) => e.quote.trim()).map((e) => locateQuote(doc, e.quote, e.source));
        let result = it.result as string;
        let confidence = it.confidence as string;
        let explanation = it.explanation;
        // A "supported" or "partially supported" claim must rest on at least one quote that exists in the material.
        if ((result === "supported" || result === "partially_supported") && !evidence.some((e) => e.verified)) {
          const was = result === "supported" ? "supported" : "partially supported";
          result = "inferred";
          confidence = "low";
          explanation = `${explanation} [Talyn: the quoted evidence could not be found verbatim in the candidate's material, so this was changed from "${was}" to needing review. Verify before relying on it.]`;
        }
        return { ...base, result, evidence, explanation, missingInfo: it.missing_info, confidence };
      });
    } catch (err) {
      if (err instanceof AiUnavailableError || err instanceof AiRequestError) return { ok: false, error: err.message, reason: "failed" };
      logError("assessment.ai_failed", err, { applicationId });
      return { ok: false, error: "The assessment could not be completed. Please try again.", reason: "failed" };
    }
  } else {
    const allText = [...doc.resumePages, doc.profileText, doc.sourceText ?? ""].join("\n");
    const preferredSource = (snippet: string) => (doc.resumePages.some((p) => p.includes(snippet)) ? "resume" : doc.profileText.includes(snippet) ? "profile" : "source");
    drafts = criteria.map((c) => {
      const base = { criterionId: c.id, criterionName: c.name, importance: c.importance, kind: c.kind };
      if (c.kind === "skill") {
        const terms = skillTerms(c.name, c.aliases);
        const hits = findSkillMentions(terms, allText);
        if (hits.length) {
          const evidence = hits.map((h) => locateQuote(doc, h.snippet, preferredSource(h.snippet)));
          const ambiguous = hits.every((h) => h.term.replace(/[^a-z0-9]/g, "").length <= 2);
          return {
            ...base,
            // A short name ("Go", "R") matches ordinary words too, so a person decides.
            result: ambiguous ? "inferred" : "supported",
            evidence,
            explanation: ambiguous
              ? `“${hits[0].term}” appears in the candidate's material, but short skill names also match ordinary words. Check the excerpt.`
              : `The candidate's material names “${hits[0].term}”. A mention shows the skill is listed, not how deep it is (keyword check, not AI).`,
            missingInfo: ambiguous ? "Confirm from the CV or with the candidate." : "",
            confidence: ambiguous ? "low" : "medium",
          };
        }
        const words = keywordsFor(c.name, "");
        const partial = words.length > 1 ? keywordMatch(words, allText) : [];
        if (partial.length)
          return {
            ...base,
            result: "inferred",
            evidence: partial.map((h) => locateQuote(doc, h.snippet, preferredSource(h.snippet))),
            explanation: `Related words appear (${Array.from(new Set(partial.flatMap((h) => h.matched))).join(", ")}), but not the skill itself. A recruiter decides.`,
            missingInfo: "Read the CV or ask the candidate.",
            confidence: "low",
          };
        return {
          ...base,
          result: "not_stated",
          evidence: [],
          explanation: `Nothing in the CV, candidate-provided information${doc.sourceText ? " or linked source record" : ""} names ${terms.map((t) => `“${t}”`).join(", ")}.`,
          missingInfo: "Missing evidence is not proof the candidate lacks this skill. Keyword checks miss synonyms — add aliases or ask the candidate.",
          confidence: null,
        };
      }
      const kws = keywordsFor(c.name, c.description);
      const hits = keywordMatch(kws, allText);
      if (hits.length === 0)
        return {
          ...base,
          result: "not_stated",
          evidence: [],
          explanation: `No lines matched the keywords: ${kws.join(", ") || "(none)"}.`,
          missingInfo: "Keyword checks miss synonyms and context. Read the resume or ask the candidate.",
          confidence: null,
        };
      return {
        ...base,
        // Keyword overlap is never treated as proof for a broader criterion; a recruiter must confirm.
        result: "inferred",
        evidence: hits.map((h) => locateQuote(doc, h.snippet, preferredSource(h.snippet))),
        explanation: `Keyword match on: ${Array.from(new Set(hits.flatMap((h) => h.matched))).join(", ")}. Check the context — a keyword match does not confirm the criterion.`,
        missingInfo: "",
        confidence: "low",
      };
    });
  }

  // The evaluation score is computed by Talyn over evaluation criteria only (skills are counted
  // separately). The AI recommendation is skipped in batch runs to keep them fast and cheap.
  const score = computeScore(drafts.map((d) => ({ name: d.criterionName, importance: d.importance, result: d.result, kind: d.kind })), weightsOf(role));
  let recommendation: string | null = null;
  let recommendationJson: Record<string, unknown> | null = null;
  const criteriaDrafts = drafts.filter((d) => d.kind !== "skill" && d.importance !== "informational");
  if (mode === "ai" && !opts.batch && criteriaDrafts.length) {
    try {
      const rec = await recommendWithAi({
        roleTitle: role.title,
        items: criteriaDrafts.map((d) => ({ name: d.criterionName, importance: d.importance, result: d.result, explanation: d.explanation, missingInfo: d.missingInfo })),
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
    recommendationJson = {
      unavailable:
        mode !== "ai"
          ? "Recommendations are only generated with AI assessments."
          : opts.batch
            ? "Not generated during “Reassess candidates”. Re-assess this candidate individually to get one."
            : "No weighted evaluation criteria to base a recommendation on.",
    };
  }
  const ai = aiStatus();

  await db.assessment.create({
    data: {
      orgId: auth.orgId,
      applicationId,
      resumeId: resume?.id ?? null,
      profileHash: profileFingerprint(profile),
      sourceProfileId: source?.id ?? null,
      generator: mode,
      model: mode === "ai" ? `${ai.provider}:${ai.model}` : null,
      criteriaSnapshot: JSON.stringify(criteria.map((c) => ({ id: c.id, updatedAt: c.updatedAt.toISOString() }))),
      criteriaVersion: role.criteriaVersion,
      engineVersion: mode === "ai" ? ASSESSMENT_ENGINE_VERSION : "keyword-v2 (skill mentions) + alignment-v1",
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
          kind: d.kind,
          result: d.result,
          evidenceJson: JSON.stringify(d.evidence),
          explanation: d.explanation,
          missingInfo: d.missingInfo,
          confidence: d.confidence,
        })),
      },
    },
  });
  if (!opts.batch)
    await audit(auth, "assessment.run", {
      subjectType: "application",
      subjectId: applicationId,
      candidateId: app.candidateId,
      roleId: app.roleId,
      applicationId,
      meta: { generator: mode, model: mode === "ai" ? `${ai.provider}:${ai.model}` : null, criteriaVersion: role.criteriaVersion, score: score.score, coverage: Math.round(score.coverage * 100) },
    });
  return { ok: true, generator: mode };
}
