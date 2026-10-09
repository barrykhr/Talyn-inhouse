import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { APP_ORIGIN_LABEL, REJECT_REASON_LABEL, DECISION_LABEL, RECOMMENDATION_LABEL, RESULT_LABEL, STAGE_LABEL, type AssessmentResult, type Decision, type Recommendation, type Stage } from "@/lib/domain";
import { computeScore, weightsOf, type Weights } from "@/lib/score";
import { THRESHOLD_LABEL, matchForApplication, roleSkillConfig, skillStatus, SKILL_STATUS_LABEL } from "@/lib/skills";
import { csvResponse, today } from "@/lib/export";

/** Pipeline export for one role: one row per candidate, one column per approved criterion (latest assessment, with recruiter overrides applied). */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const role = await db.role.findFirst({
    where: { id, orgId: auth.orgId },
    include: {
      criteria: { where: { status: "approved" }, orderBy: { position: "asc" } },
      applications: {
        include: {
          candidate: { include: { resumes: { where: { isCurrent: true }, select: { id: true }, take: 1 } } },
          assessments: { orderBy: { createdAt: "desc" }, take: 1, include: { items: true } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  if (!role) return new Response("Not found", { status: 404 });

  const headers = [
    "candidate",
    "email",
    "origin",
    "sample",
    "stage",
    "decision",
    "reject_reason",
    "decision_note",
    "assessment_type",
    "assessment_reviewed",
    "required_skills_evidenced",
    "required_skills_total",
    "skill_threshold",
    "skill_threshold_status",
    "criteria_version",
    "criteria_alignment_0_100",
    "evidence_coverage_pct",
    "score_status",
    "ai_recommendation",
    "recommendation_review",
    "final_recommendation",
    ...role.criteria.map((c) => `${c.name} [${c.kind === "skill" ? "skill, " : ""}${c.importance === "essential" ? "required" : c.importance}]`)];
  const config = roleSkillConfig(role, role.criteria);
  const weights = weightsOf(role);
  const rows = role.applications.map((a) => {
    const asmt = a.assessments[0];
    const m = matchForApplication(a, { config, approved: role.criteria, criteriaVersion: role.criteriaVersion });
    const byCriterion = new Map(asmt?.items.map((i) => [i.criterionId, i]) ?? []);
    return [
      a.candidate.fullName,
      a.candidate.email,
      APP_ORIGIN_LABEL[a.origin] ?? a.origin,
      a.candidate.isSample ? "yes (fictional)" : "",
      STAGE_LABEL[a.stage as Stage] ?? a.stage,
      a.decision ? DECISION_LABEL[a.decision as Decision] : "",
      a.decisionReason ? (REJECT_REASON_LABEL[a.decisionReason] ?? a.decisionReason) : "",
      a.decisionNote ?? "",
      asmt ? asmt.generator : "",
      asmt ? (asmt.status === "reviewed" ? "yes" : "no") : "",
      m.evidenced ?? "",
      m.required,
      config.threshold ?? "",
      THRESHOLD_LABEL[m.state],
      ...scoreCols(asmt, weights),
      ...role.criteria.map((c) => {
        const it = byCriterion.get(c.id);
        if (!it) return "";
        const r = (it.overrideResult ?? it.result) as AssessmentResult;
        const label = c.kind === "skill" ? SKILL_STATUS_LABEL[skillStatus(r)] : (RESULT_LABEL[r] ?? r);
        return `${label}${it.overrideResult ? " (recruiter)" : ""}`;
      }),
    ];
  });
  await audit(auth, "export.pipeline", { subjectType: "role", subjectId: role.id, roleId: role.id, meta: { rows: rows.length } });
  return csvResponse(`talyn-${role.title}-pipeline-${today()}.csv`, headers, rows);
}

type Asmt = {
  criteriaVersion: number | null;
  recommendation: string | null;
  recommendationStatus: string | null;
  finalRecommendation: string | null;
  items: { criterionName: string; importance: string; result: string; overrideResult: string | null; kind: string }[];
};
function scoreCols(a: Asmt | undefined, weights: Weights): unknown[] {
  if (!a) return ["", "", "", "", "", "", ""];
  const s = computeScore(a.items.map((i) => ({ name: i.criterionName, importance: i.importance, result: i.result, overrideResult: i.overrideResult, kind: i.kind })), weights);
  const rec = (r: string | null) => (r ? RECOMMENDATION_LABEL[r as Recommendation] ?? r : "");
  return [a.criteriaVersion ?? "", s.score ?? "", Math.round(s.coverage * 100), s.status, rec(a.recommendation), a.recommendationStatus ?? "", rec(a.finalRecommendation)];
}
