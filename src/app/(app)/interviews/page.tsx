import Link from "next/link";
import { Badge, Card, EmptyState, PageHeader, SectionTitle, formatDate, formatDateTime } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Interviews" };

const STATUS: Record<string, { label: string; tone: "neutral" | "warn" | "ok" }> = {
  not_started: { label: "To do", tone: "warn" },
  draft: { label: "Draft saved", tone: "neutral" },
  submitted: { label: "Submitted", tone: "ok" },
};
const DECISION: Record<string, string> = { advance: "Advance", hold: "Hold", decline: "Decline" };

/** Interviews home: your scorecards first, then every interview plan in the workspace. */
export default async function InterviewsHome() {
  const auth = await requireAuth();
  const [mine, kits] = await Promise.all([
    db.interviewAssignment.findMany({
      where: { interviewerId: auth.userId, stage: { kit: { orgId: auth.orgId, status: "shared" } } },
      include: { stage: { select: { name: true, scheduledAt: true, kit: { select: { id: true, application: { select: { candidate: { select: { fullName: true } }, role: { select: { title: true } } } } } } } } },
      orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    }),
    db.interviewKit.findMany({
      where: { orgId: auth.orgId },
      orderBy: { updatedAt: "desc" },
      take: 100,
      include: { application: { select: { candidate: { select: { fullName: true } }, role: { select: { id: true, title: true } } } }, stages: { select: { assignments: { select: { status: true } } } } },
    }),
  ]);
  const todo = mine.filter((a) => a.status !== "submitted");
  const done = mine.filter((a) => a.status === "submitted");
  return (
    <div className="space-y-6">
      <PageHeader title="Interviews" meta={<span>Structured interview plans, independent scorecards and team debriefs. Talyn organizes the evidence; people decide.</span>} />

      <section aria-labelledby="mine-h">
        <SectionTitle hint="Scorecards are private until you submit. You'll see others' feedback after you submit yours.">
          <span id="mine-h">Your scorecards</span>
        </SectionTitle>
        {mine.length === 0 ? (
          <EmptyState title="Nothing assigned to you" body="When a recruiter assigns you to an interview stage and shares the plan, your scorecard appears here." />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {[...todo, ...done].map((a) => (
              <Link key={a.id} href={a.status === "submitted" ? `/interviews/${a.stage.kit.id}/debrief` : `/interviews/${a.stage.kit.id}/scorecard/${a.id}`} className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 hover:bg-sunken/50">
                <div>
                  <div className="font-medium">{a.stage.kit.application.candidate.fullName}</div>
                  <div className="text-[12.5px] text-muted">
                    {a.stage.kit.application.role.title} · {a.stage.name}
                    {a.stage.scheduledAt ? ` · ${formatDateTime(a.stage.scheduledAt)}` : ""}
                  </div>
                </div>
                <Badge tone={STATUS[a.status].tone}>{STATUS[a.status].label}</Badge>
              </Link>
            ))}
          </Card>
        )}
      </section>

      <section aria-labelledby="plans-h">
        <SectionTitle hint="Create a plan from a candidate's role on the role's Interviews tab or the candidate record.">
          <span id="plans-h">Interview plans</span>
        </SectionTitle>
        {kits.length === 0 ? (
          <EmptyState title="No interview plans yet" body="Open a role, go to Interviews, and create a plan for a shortlisted candidate. The kit is drafted from the role's approved criteria." action={<Link href="/roles" className="font-medium underline">Go to roles</Link>} />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {kits.map((k) => {
              const all = k.stages.flatMap((s) => s.assignments);
              const sub = all.filter((a) => a.status === "submitted").length;
              return (
                <Link key={k.id} href={`/interviews/${k.id}`} className="grid gap-x-4 gap-y-1 px-4 py-3 hover:bg-sunken/50 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto] md:items-center">
                  <div>
                    <div className="font-medium">{k.application.candidate.fullName}</div>
                    <div className="text-[12.5px] text-muted">{k.application.role.title}</div>
                  </div>
                  <div className="text-[12.5px] text-muted">
                    {k.status === "shared" ? `Shared ${k.sharedAt ? formatDate(k.sharedAt) : ""}` : "Draft plan"} · {sub} of {all.length} scorecard{all.length === 1 ? "" : "s"} submitted
                  </div>
                  <div>{k.decision ? <Badge tone="ink">{DECISION[k.decision]}</Badge> : <span className="text-[12.5px] text-faint">No team decision</span>}</div>
                </Link>
              );
            })}
          </Card>
        )}
      </section>
    </div>
  );
}
