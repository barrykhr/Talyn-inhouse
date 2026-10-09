import Link from "next/link";
import { ActionButton } from "@/components/client";
import { OriginBadge, RoleTabs, SampleBadge } from "@/components/role-workspace";
import { RoleStatusBadge } from "@/components/status";
import { Badge, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { getAtsConnector } from "@/lib/ats/connector";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { STAGE_LABEL, type Stage } from "@/lib/domain";
import { DECISION_LABEL } from "@/lib/interviews/rubric";
import { createKit } from "@/server/interview-actions";
import { ownRole } from "@/server/scope";

export const metadata = { title: "Interviews" };
// Creating a kit can draft questions with AI.
export const maxDuration = 300;

/** Role → Interviews: shortlisted candidates and their interview plans. */
export default async function RoleInterviewsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ all?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const { all } = await searchParams;
  const role = await ownRole(auth, id);
  const [apps, criteria, toReview] = await Promise.all([
    db.application.findMany({
      where: { orgId: auth.orgId, roleId: id },
      orderBy: { updatedAt: "desc" },
      select: {
        id: true,
        origin: true,
        originDetail: true,
        decision: true,
        stage: true,
        candidateId: true,
        candidate: { select: { fullName: true, currentTitle: true, isSample: true } },
        interviewKit: { select: { id: true, status: true, decision: true, stages: { select: { assignments: { select: { status: true } } } } } },
      },
    }),
    db.criterion.findMany({ where: { roleId: id, orgId: auth.orgId }, select: { status: true } }),
    db.sourcedProfile.count({ where: { orgId: auth.orgId, roleId: id, status: "new" } }),
  ]);
  const approved = criteria.filter((c) => c.status === "approved").length;
  // Shortlisted candidates and anyone who already has a plan; "all" shows every active candidate.
  const list = apps.filter((a) => (all ? a.stage !== "rejected" : a.decision === "advance" || a.interviewKit));
  const withKit = apps.filter((a) => a.interviewKit).length;

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/roles" className="hover:text-ink">
            Roles
          </Link>
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {role.title} <RoleStatusBadge status={role.status} />
          </span>
        }
      />
      <RoleTabs
        roleId={role.id}
        active="interviews"
        counts={{ applicants: apps.filter((a) => a.origin !== "discovered").length, discover: toReview, shortlist: apps.filter((a) => a.decision === "advance").length, criteria: approved, interviews: withKit }}
        attention={{ criteria: criteria.filter((c) => c.status === "proposed").length }}
        showAts={!!getAtsConnector()}
      />
      <p className="mb-4 text-[13px] text-muted">
        Interview plans are built from this role&apos;s {approved} approved criteria. Interviewers score independently against one rubric; the team discusses the evidence in a debrief, and a person
        records the decision.
      </p>
      {approved === 0 && (
        <EmptyState
          className="mb-4"
          title="Approve criteria first"
          body="Interview kits are generated only from the role's approved criteria, so nothing is invented."
          action={
            <Link href={`/roles/${role.id}?tab=criteria`} className="font-medium underline">
              Go to criteria
            </Link>
          }
        />
      )}

      <SectionTitle
        action={
          <Link href={`/roles/${role.id}/interviews${all ? "" : "?all=1"}`} className="text-[13px] text-muted underline hover:text-ink">
            {all ? "Show shortlist only" : "Show all active candidates"}
          </Link>
        }
      >
        {all ? "Active candidates" : "Shortlisted candidates"}
      </SectionTitle>
      {list.length === 0 ? (
        <EmptyState
          title={all ? "No active candidates" : "No one shortlisted yet"}
          body="Shortlist applicants or discovered people first, then create an interview plan here."
          action={
            <Link href={`/roles/${role.id}?tab=shortlist`} className="font-medium underline">
              Go to Shortlist
            </Link>
          }
        />
      ) : (
        <Card className="divide-y divide-line overflow-hidden">
          {list.map((a) => {
            const k = a.interviewKit;
            const assigns = k?.stages.flatMap((s) => s.assignments) ?? [];
            const sub = assigns.filter((x) => x.status === "submitted").length;
            return (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Link href={`/candidates/${a.candidateId}?role=${role.id}`} className="font-medium hover:underline">
                      {a.candidate.fullName}
                    </Link>
                    <OriginBadge origin={a.origin} detail={a.originDetail} />
                    {a.candidate.isSample && <SampleBadge />}
                  </div>
                  <div className="text-[12.5px] text-muted">
                    {a.candidate.currentTitle ?? "No current role on record"} · {STAGE_LABEL[a.stage as Stage]}
                  </div>
                </div>
                {k ? (
                  <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
                    <span className="text-muted">
                      {k.status === "shared" ? "Shared" : "Draft plan"} · {sub}/{assigns.length} scorecards
                    </span>
                    {k.decision && <Badge tone="ink">{DECISION_LABEL[k.decision as keyof typeof DECISION_LABEL]}</Badge>}
                    <Link href={`/interviews/${k.id}`} className="rounded-lg border border-line-strong px-2.5 py-1 font-medium hover:bg-sunken">
                      Plan
                    </Link>
                    <Link href={`/interviews/${k.id}/debrief`} className="rounded-lg border border-line-strong px-2.5 py-1 font-medium hover:bg-sunken">
                      Debrief
                    </Link>
                  </div>
                ) : (
                  <ActionButton action={createKit.bind(null, a.id)} variant="primary" size="md" pendingLabel="Drafting kit…">
                    Create interview plan
                  </ActionButton>
                )}
              </div>
            );
          })}
        </Card>
      )}
    </>
  );
}
