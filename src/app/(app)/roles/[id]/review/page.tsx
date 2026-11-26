import { MustHaveBadge } from "@/components/must-have";
import { mustHaveFromAssessment } from "@/lib/loop/must-have";
import Link from "next/link";
import { ProfileScoreChip } from "@/components/profile-score";
import { RoleTabs, SampleBadge } from "@/components/role-workspace";
import { RoleStatusBadge } from "@/components/status";
import { Breadcrumbs, Card, EmptyState, Notice, PageHeader } from "@/components/ui";
import { getAtsConnector } from "@/lib/ats/connector";
import { requireAuth } from "@/lib/auth";
import { bestQuote, truncate } from "@/lib/candidate-summary";
import { db } from "@/lib/db";
import { parseEvidence } from "@/lib/evidence";
import { FEEDBACK_LABEL, feedbackSummary, type FeedbackVerdict } from "@/lib/feedback";
import { ownRole } from "@/server/scope";
import { FeedbackForm } from "./feedback-form";

export const metadata = { title: "Hiring manager review" };

const FOUND = new Set(["supported"]);
const GAP = new Set(["not_stated", "confirmed_absent", "inferred", "partially_supported", "conflicting"]);

/**
 * Role → Hiring manager review: the shortlist with the evidence that matters, for a hiring manager to
 * react to. Their feedback goes to the recruiter; it never changes a stage or a decision.
 */
export default async function HiringReviewPage({ params }: { params: Promise<{ id: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const role = await ownRole(auth, id);
  const [allApps, criteria, toReview, counts] = await Promise.all([
    db.application.findMany({
      where: { orgId: auth.orgId, roleId: id, decision: "advance" },
      orderBy: { decidedAt: "desc" },
      select: {
        id: true,
        candidateId: true,
        origin: true,
        interest: true,
        decidedAt: true,
        decidedByName: true,
        decisionNote: true,
        candidate: { select: { fullName: true, currentTitle: true, currentCompany: true, location: true, isSample: true } },
        assessments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, items: { select: { criterionId: true, criterionName: true, kind: true, importance: true, result: true, overrideResult: true, evidenceJson: true } } },
        },
        profileScores: { orderBy: { createdAt: "desc" }, take: 1, include: { scoringVersion: { select: { version: true } } } },
        hiringFeedback: { orderBy: { updatedAt: "desc" } },
      },
    }),
    db.criterion.findMany({ where: { roleId: id, orgId: auth.orgId }, select: { status: true } }),
    db.sourcedProfile.count({ where: { orgId: auth.orgId, roleId: id, status: "new" } }),
    db.application.groupBy({ by: ["origin"], where: { orgId: auth.orgId, roleId: id }, _count: true }),
  ]);
  const applicants = counts.filter((c) => c.origin !== "discovered").reduce((n, c) => n + c._count, 0);
  const mustHaves = await db.criterion.findMany({ where: { orgId: auth.orgId, roleId: id, status: "approved", mustHave: true }, select: { id: true, name: true } });
  // People the team found reach the hiring manager only after they've said they're interested.
  const waiting = allApps.filter((a) => a.origin === "discovered" && a.interest !== "interested");
  const apps = allApps.filter((a) => !(a.origin === "discovered" && a.interest !== "interested"));

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Roles", href: "/roles" }, { label: role.title, href: `/roles/${role.id}` }, { label: "Hiring manager review" }]} />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {role.title} <RoleStatusBadge status={role.status} />
          </span>
        }
      />
      <RoleTabs
        roleId={role.id}
        active="shortlist"
        counts={{ applicants, discover: toReview, shortlist: apps.length, criteria: criteria.filter((c) => c.status === "approved").length }}
        showAts={!!getAtsConnector()}
      />
      <Notice tone="neutral" className="mb-4">
        For hiring managers: the people the recruiter shortlisted, with the evidence behind each. Say Interested, Not a fit or ask a question. Your feedback goes to the recruiter; it doesn&apos;t move anyone or record a decision.{" "}
        <Link href={`/roles/${role.id}/calibrate`} className="font-medium text-brand hover:underline">
          Calibrate the brief →
        </Link>
      </Notice>
      {waiting.length > 0 && (
        <p className="mb-3 text-[12.5px] text-muted">
          {waiting.length} {waiting.length === 1 ? "person" : "people"} your team found {waiting.length === 1 ? "is" : "are"} shortlisted but haven&apos;t confirmed interest yet. They appear here once they do.
        </p>
      )}
      {apps.length === 0 ? (
        <EmptyState title="No one shortlisted yet" body="When the recruiter shortlists candidates for this role, they appear here for your review." />
      ) : (
        <div className="space-y-4">
          {apps.map((a) => {
            const latest = a.assessments[0];
            const p = a.profileScores[0];
            const valid = p && latest && p.assessmentId === latest.id;
            const items = (latest?.items ?? []).filter((i) => i.importance !== "informational");
            const result = (i: (typeof items)[number]) => i.overrideResult ?? i.result;
            const strengths = items
              .filter((i) => FOUND.has(result(i)))
              .map((i) => ({ name: i.criterionName, q: bestQuote(parseEvidence(i.evidenceJson)) }))
              .sort((x, y) => Number(!!y.q?.verified) - Number(!!x.q?.verified))
              .slice(0, 3);
            const gaps = items.filter((i) => GAP.has(result(i)) && i.importance !== "preferred").map((i) => i.criterionName);
            const mine = a.hiringFeedback.find((f) => f.userId === auth.userId) ?? null;
            const others = a.hiringFeedback.filter((f) => f.userId !== auth.userId);
            return (
              <Card key={a.id} className="grid gap-4 p-4 md:grid-cols-[minmax(0,1fr)_320px]">
                <div className="min-w-0 space-y-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/candidates/${a.candidateId}?role=${role.id}`} className="text-[15px] font-semibold hover:underline">
                      {a.candidate.fullName}
                    </Link>
                    {a.candidate.isSample && <SampleBadge />}
                    <MustHaveBadge r={mustHaveFromAssessment(mustHaves, latest?.items ?? null)} />
                    {a.origin === "discovered" && <span className="rounded-md bg-ok-soft px-1.5 py-0.5 text-[11.5px] font-medium text-ok">Confirmed interest</span>}
                    <ProfileScoreChip
                      s={
                        valid
                          ? { id: p.id, score: p.score, coverage: p.coverage, status: p.status, band: p.band, bandLabel: p.bandLabel, version: p.scoringVersion.version, currentVersion: p.scoringVersion.version, createdAt: p.createdAt, createdByName: p.createdByName, trigger: p.trigger }
                          : null
                      }
                    />
                  </div>
                  <p className="text-[13px] text-muted">{[a.candidate.currentTitle, a.candidate.currentCompany, a.candidate.location].filter(Boolean).join(" · ") || "No current role on file"}</p>
                  {strengths.length > 0 && (
                    <div>
                      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Strongest evidence</div>
                      <ul className="mt-1 space-y-1 text-[13px]">
                        {strengths.map((s) => (
                          <li key={s.name}>
                            <span className="font-medium">{s.name}</span>
                            {s.q && <span className="quote ml-1 text-ink-2">“{truncate(s.q.quote, 140)}”</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <div>
                    <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Gaps against the role</div>
                    <p className="mt-1 text-[13px]">{gaps.length ? gaps.join(" · ") : latest ? "None among the required items." : "Not assessed yet."}</p>
                  </div>
                  {a.decisionNote && <p className="text-[12.5px] text-muted">Recruiter&apos;s note: {a.decisionNote}</p>}
                  <p className="text-[11.5px] text-faint">Shortlisted by {a.decidedByName ?? "the recruiter"}</p>
                </div>
                <div className="space-y-3 border-t border-line pt-3 md:border-l md:border-t-0 md:pl-4 md:pt-0">
                  <div>
                    <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Your view</div>
                    <FeedbackForm applicationId={a.id} mine={mine ? { verdict: mine.verdict, comment: mine.comment } : null} />
                  </div>
                  <div>
                    <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Hiring team</div>
                    <p className="text-[12.5px] text-muted">{feedbackSummary(a.hiringFeedback)}</p>
                    {others.length > 0 && (
                      <ul className="mt-1 space-y-1 text-[12.5px]">
                        {others.map((f) => (
                          <li key={f.id}>
                            <span className="font-medium">{f.userName}</span>: {FEEDBACK_LABEL[f.verdict as FeedbackVerdict] ?? f.verdict}
                            {f.comment && <span className="text-ink-2"> — {f.comment}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
