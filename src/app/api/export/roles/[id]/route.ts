import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECISION_LABEL, RECOMMENDATION_LABEL, RESULT_LABEL, STAGE_LABEL, type AssessmentResult, type Decision, type Recommendation, type Stage } from "@/lib/domain";
import { computeScore } from "@/lib/score";
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
          candidate: true,
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
    "stage",
    "decision",
    "decision_note",
    "assessment_type",
    "assessment_reviewed",
    "criteria_version",
    "alignment_score_0_100",
    "evidence_coverage_pct",
    "score_status",
    "ai_recommendation",
    "recommendation_review",
    "final_recommendation",
    ...role.criteria.map((c) => `${c.name} [${c.importance}]`)];
  const rows = role.applications.map((a) => {
    const asmt = a.assessments[0];
    const byCriterion = new Map(asmt?.items.map((i) => [i.criterionId, i]) ?? []);
    return [
      a.candidate.fullName,
      a.candidate.email,
      STAGE_LABEL[a.stage as Stage] ?? a.stage,
      a.decision ? DECISION_LABEL[a.decision as Decision] : "",
      a.decisionNote ?? "",
      asmt ? asmt.generator : "",
      asmt ? (asmt.status === "reviewed" ? "yes" : "no") : "",
      ...scoreCols(asmt),
      ...role.criteria.map((c) => {
        const it = byCriterion.get(c.id);
        if (!it) return "";
        const r = (it.overrideResult ?? it.result) as AssessmentResult;
        return `${RESULT_LABEL[r] ?? r}${it.overrideResult ? " (recruiter)" : ""}`;
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
  items: { criterionName: string; importance: string; result: string; overrideResult: string | null }[];
};
function scoreCols(a: Asmt | undefined): unknown[] {
  if (!a) return ["", "", "", "", "", "", ""];
  const s = computeScore(a.items.map((i) => ({ name: i.criterionName, importance: i.importance, result: i.result, overrideResult: i.overrideResult })));
  const rec = (r: string | null) => (r ? RECOMMENDATION_LABEL[r as Recommendation] ?? r : "");
  return [a.criteriaVersion ?? "", s.score ?? "", Math.round(s.coverage * 100), s.status, rec(a.recommendation), a.recommendationStatus ?? "", rec(a.finalRecommendation)];
}
