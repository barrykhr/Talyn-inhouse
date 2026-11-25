import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/client";
import { AiMark, Card, EmptyState, Notice, SectionTitle } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadKitForUser } from "@/lib/interviews/access";
import { RATING_LABEL, RATING_LEVELS, parseAnchors } from "@/lib/interviews/rubric";
import { addStage, shareKit } from "@/server/interview-actions";
import { eventViews } from "@/server/scheduling-store";
import { calendarConfigured } from "@/lib/calendar/google";
import { EventCard } from "@/components/calendar/event-card";
import { KitHeader } from "../kit-header";
import { gapProbes } from "@/lib/interviews/gaps";
import { AddCompetencyForm, CompetencyCard, HiringManagerSelect, StageCard, type CompetencyView, type StageView } from "./kit-editor";

export const metadata = { title: "Interview plan" };
// Kit drafting can run AI as a server action from related pages.
export const maxDuration = 300;

/** Plan & kit: competencies from the role's criteria, questions, rubric, stages and interviewers. */
export default async function KitPage({ params, searchParams }: { params: Promise<{ kitId: string }>; searchParams: Promise<{ notice?: string }> }) {
  const auth = await requireAuth();
  const { kitId } = await params;
  const { notice } = await searchParams;
  const v = await loadKitForUser(auth, kitId);
  if (!v) notFound();
  const { kit } = v;
  const [members, criteria, latestAssessment, followUps, teamQs] = await Promise.all([
    db.membership.findMany({ where: { orgId: auth.orgId }, include: { user: { select: { id: true, name: true } } }, orderBy: { createdAt: "asc" } }),
    db.criterion.findMany({ where: { roleId: kit.roleId, orgId: auth.orgId, status: "approved" }, select: { id: true, name: true } }),
    db.assessment.findFirst({
      where: { orgId: auth.orgId, applicationId: kit.applicationId },
      orderBy: { createdAt: "desc" },
      select: { items: { select: { criterionId: true, criterionName: true, kind: true, importance: true, result: true, overrideResult: true, missingInfo: true } } },
    }),
    db.question.findMany({ where: { orgId: auth.orgId, applicationId: kit.applicationId, kind: "follow_up" }, select: { criterionId: true, criterionName: true, text: true, status: true } }),
    db.hiringFeedback.findMany({ where: { orgId: auth.orgId, applicationId: kit.applicationId, verdict: "question" }, select: { comment: true } }),
  ]);
  const inKit = new Set(kit.competencies.map((c) => c.criterionId).filter(Boolean));
  const probes = latestAssessment ? gapProbes(latestAssessment.items, followUps, teamQs.map((q) => ({ text: q.comment })), inKit as Set<string>) : [];
  const memberViews = members.map((m) => ({ userId: m.user.id, name: m.user.name, role: m.role }));
  const competencies: CompetencyView[] = kit.competencies.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    importance: c.importance,
    origin: c.origin,
    anchorsOrigin: c.anchorsOrigin,
    anchors: parseAnchors(c.anchorsJson, c.name),
    questions: c.questions.map((q) => ({ id: q.id, text: q.text, followUps: q.followUps, guidance: q.guidance, origin: q.origin, edited: q.edited })),
  }));
  const submittedStages = new Set(kit.stages.filter((s) => s.assignments.some((a) => a.status === "submitted")).map((s) => s.id));
  const stages: StageView[] = kit.stages.map((s) => ({
    id: s.id,
    name: s.name,
    purpose: s.purpose,
    competencyIds: JSON.parse(s.competencyIdsJson),
    scheduledAt: s.scheduledAt?.toISOString() ?? null,
    durationMins: s.durationMins,
    locationNote: s.locationNote,
    assignments: s.assignments.map((a) => ({ id: a.id, interviewerId: a.interviewerId, interviewerName: a.interviewerName, status: a.status, submittedAt: a.submittedAt?.toISOString() ?? null })),
  }));
  const ai = kit.generator.startsWith("ai:");
  const criteriaChanged = kit.criteriaVersion != null && kit.criteriaVersion !== kit.application.role.criteriaVersion;
  const assignedCount = stages.reduce((n, s) => n + s.assignments.length, 0);
  const events = await eventViews(auth, kit, kit.stages.map((s) => s.id));
  const calendarLive = calendarConfigured();

  return (
    <>
      <KitHeader
        kitId={kit.id}
        candidate={kit.application.candidate}
        role={kit.application.role}
        status={kit.status}
        active="plan"
        myScorecards={kit.status === "shared" ? v.mine.map((a) => ({ id: a.id, stage: kit.stages.find((s) => s.id === a.stageId)?.name ?? "Stage", status: a.status })) : []}
        decision={kit.decision}
      />
      {notice && <Notice tone="warn" className="mb-4">{notice}</Notice>}
      {criteriaChanged && (
        <Notice tone="warn" className="mb-4">
          The role&apos;s criteria changed after this kit was created (v{kit.criteriaVersion} → v{kit.application.role.criteriaVersion}). Review the competencies below; Talyn doesn&apos;t change a kit
          on its own.
        </Notice>
      )}
      {kit.application.candidate.isSample && <Notice tone="warn" className="mb-4">Sample candidate — a fictional person. Use this plan to try the workflow only.</Notice>}

      <div className="mb-5 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-surface px-4 py-3 text-[13px]">
        {kit.status === "draft" ? (
          <>
            <span>
              <strong>Draft.</strong> Interviewers can&apos;t open scorecards until you share the plan. {assignedCount === 0 && "Assign at least one interviewer first."}
            </span>
            <span className="ml-auto">
              <ActionButton
                action={shareKit.bind(null, kit.id)}
                variant="primary"
                size="md"
                confirm="Share with the assigned interviewers? Their scorecards open in Talyn → Interviews. Talyn won't message them or book meetings."
                successMessage="Shared — let the interviewers know; Talyn didn't message them"
              >
                Share with interviewers
              </ActionButton>
            </span>
          </>
        ) : (
          <span>
            Shared {kit.sharedAt?.toLocaleDateString()} by {kit.sharedByName}. Interviewers find their scorecards under <Link href="/interviews" className="underline">Interviews</Link>. Talyn didn&apos;t
            notify anyone — let them know yourself.
          </span>
        )}
        <span className="flex items-center gap-2">
          <span className="text-muted">Hiring manager:</span>
          <HiringManagerSelect kitId={kit.id} value={kit.hiringManagerId} members={memberViews} />
        </span>
        <span className="text-muted">Owner: {kit.ownerName}</span>
      </div>

      <section aria-labelledby="gaps-h" className="mb-6">
        <SectionTitle hint="Requirements this candidate's material doesn't yet prove, each with a question to ask. From their latest assessment; questions come from their follow-ups, the hiring team, or a neutral template.">
          <span id="gaps-h">Probe this candidate&apos;s gaps</span>
        </SectionTitle>
        {!latestAssessment ? (
          <Card className="px-4 py-3 text-[13px] text-muted">Not assessed yet. Assess the candidate to see which requirements to probe.</Card>
        ) : probes.length === 0 ? (
          <Card className="px-4 py-3 text-[13px] text-muted">Every required and preferred item has evidence. Use the questions below to go deeper.</Card>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {probes.map((g, i) => (
              <div key={i} className="space-y-1 px-4 py-3 text-[13px]">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{g.criterionName}</span>
                  <span className={g.status === "conflicting" ? "rounded bg-warn-soft px-1.5 py-px text-[11px] font-semibold text-warn" : "rounded bg-sunken px-1.5 py-px text-[11px] font-semibold text-muted"}>{g.why}</span>
                  {g.inKit && <span className="text-[11.5px] text-faint">covered by a competency below</span>}
                </div>
                <p>
                  <span className="text-muted">Ask: </span>
                  {g.probe}
                </p>
                <p className="text-[11.5px] text-faint">{g.source === "follow_up" ? "From this candidate's follow-up questions" : g.source === "hiring_team" ? "From the hiring team" : "Template question"}</p>
              </div>
            ))}
          </Card>
        )}
      </section>

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <section aria-labelledby="comp-h" className="min-w-0 space-y-3">
          <SectionTitle
            hint={
              <>
                Built only from the role&apos;s approved criteria. {ai ? <AiMark label="Questions and anchors AI-drafted" /> : "Questions and anchors from templates (AI was off)."} Edit, add, reorder or remove anything before
                sharing. Ask every candidate the same questions.
              </>
            }
            action={<AddCompetencyForm kitId={kit.id} available={criteria.filter((c) => !inKit.has(c.id))} />}
          >
            <span id="comp-h">Competencies &amp; questions</span>
          </SectionTitle>
          {competencies.length === 0 ? (
            <EmptyState title="No competencies" body="Add one from the role's approved criteria." />
          ) : (
            competencies.map((c, i) => <CompetencyCard key={c.id} c={c} index={i} total={competencies.length} />)
          )}
        </section>

        <aside className="min-w-0 space-y-3" aria-labelledby="stages-h">
          <SectionTitle
            hint="Who interviews, when, and which competencies each stage covers."
            action={
              <ActionButton action={addStage.bind(null, kit.id)} successMessage="Stage added">
                + Add stage
              </ActionButton>
            }
          >
            <span id="stages-h">Stages &amp; interviewers</span>
          </SectionTitle>
          {stages.map((s) => {
            const ev = events.find((e) => e.stageId === s.id)?.view;
            return (
              <StageCard
                key={s.id}
                stage={s}
                competencies={competencies.map((c) => ({ id: c.id, name: c.name }))}
                members={memberViews}
                canRemove={!submittedStages.has(s.id) && !ev}
                scheduleSlot={
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12px] font-semibold uppercase tracking-wide text-muted">Interview time</span>
                      {!calendarLive && <span className="text-[11.5px] text-warn">Google Calendar not connected — demo mode</span>}
                      <Link href={`/interviews/${kit.id}/schedule/${s.id}${ev ? "?reschedule=1" : ""}`} className="ml-auto rounded-lg border border-line-strong px-2.5 py-1 text-[12.5px] font-medium hover:bg-sunken">
                        {ev ? "Reschedule" : "Schedule interview"}
                      </Link>
                    </div>
                    {ev ? <EventCard e={ev} rescheduleHref={`/interviews/${kit.id}/schedule/${s.id}?reschedule=1`} /> : <p className="text-[12.5px] text-faint">Not scheduled through Talyn.</p>}
                  </div>
                }
              />
            );
          })}
          <Card className="p-4 text-[12.5px]">
            <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Rating scale (same for every competency)</div>
            <ul className="space-y-0.5">
              {RATING_LEVELS.map((l) => (
                <li key={l}>
                  <span className="font-medium tabular-nums">{l}</span> — {RATING_LABEL[l]}
                </li>
              ))}
              <li>
                <span className="font-medium">Not assessed</span> — the interview didn&apos;t cover it. Not a low rating.
              </li>
            </ul>
            <p className="mt-2 text-muted">Ratings are evidence for discussion. Talyn never totals them into a verdict; the team decides in the debrief.</p>
          </Card>
        </aside>
      </div>
    </>
  );
}
