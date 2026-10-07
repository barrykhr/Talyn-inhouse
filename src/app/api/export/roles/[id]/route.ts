import { getAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECISION_LABEL, RESULT_LABEL, STAGE_LABEL, type AssessmentResult, type Decision, type Stage } from "@/lib/domain";
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

  const headers = ["candidate", "email", "stage", "decision", "decision_note", "assessment_type", "assessment_reviewed", ...role.criteria.map((c) => `${c.name} [${c.importance}]`)];
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
      ...role.criteria.map((c) => {
        const it = byCriterion.get(c.id);
        if (!it) return "";
        const r = (it.overrideResult ?? it.result) as AssessmentResult;
        return `${RESULT_LABEL[r] ?? r}${it.overrideResult ? " (recruiter)" : ""}`;
      }),
    ];
  });
  return csvResponse(`talyn-${role.title}-pipeline-${today()}.csv`, headers, rows);
}
