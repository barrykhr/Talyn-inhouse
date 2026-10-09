import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/client";
import { EmptyState, Notice, formatDateTime } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { loadKitForUser } from "@/lib/interviews/access";
import { parseAnchors, parseEntries } from "@/lib/interviews/rubric";
import { reopenScorecard } from "@/server/interview-actions";
import { KitHeader } from "../../../kit-header";
import { ScorecardForm, type ScorecardCompetency } from "./scorecard-form";

export const metadata = { title: "Scorecard" };

export default async function ScorecardPage({ params }: { params: Promise<{ kitId: string; assignmentId: string }> }) {
  const auth = await requireAuth();
  const { kitId, assignmentId } = await params;
  const v = await loadKitForUser(auth, kitId);
  if (!v) notFound();
  const { kit } = v;
  const stage = kit.stages.find((s) => s.assignments.some((a) => a.id === assignmentId));
  const a = stage?.assignments.find((x) => x.id === assignmentId);
  if (!stage || !a) notFound();
  const header = (
    <KitHeader
      kitId={kit.id}
      candidate={kit.application.candidate}
      role={kit.application.role}
      status={kit.status}
      active="scorecard"
      myScorecards={kit.status === "shared" ? v.mine.map((m) => ({ id: m.id, stage: kit.stages.find((s) => s.id === m.stageId)?.name ?? "Stage", status: m.status })) : []}
      decision={kit.decision}
    />
  );

  // Someone else's scorecard: drafts are private; submitted ones are read in the debrief.
  if (a.interviewerId !== auth.userId)
    return (
      <>
        {header}
        <EmptyState
          title={`This is ${a.interviewerName}'s scorecard`}
          body={a.status === "submitted" ? "Submitted feedback is shown in the debrief, subject to the independence rule." : "Scorecards are private to the interviewer until they submit."}
          action={
            <>
              <Link href={`/interviews/${kit.id}/debrief`} className="font-medium underline">
                Go to debrief
              </Link>
              {a.status === "submitted" && v.isOwnerOrAdmin && (
                <ActionButton action={reopenScorecard.bind(null, a.id)} confirm={`Reopen ${a.interviewerName}'s submitted scorecard so they can correct it? This is recorded.`} successMessage="Scorecard reopened">
                  Reopen for edits
                </ActionButton>
              )}
            </>
          }
        />
      </>
    );
  if (kit.status !== "shared")
    return (
      <>
        {header}
        <EmptyState title="This plan hasn't been shared yet" body="Your scorecard opens once the recruiter shares the interview plan." />
      </>
    );

  const ids = JSON.parse(stage.competencyIdsJson) as string[];
  const competencies: ScorecardCompetency[] = kit.competencies
    .filter((c) => ids.includes(c.id))
    .map((c) => ({ id: c.id, name: c.name, description: c.description, anchors: parseAnchors(c.anchorsJson, c.name), questions: c.questions.map((q) => ({ id: q.id, text: q.text, followUps: q.followUps, guidance: q.guidance })) }));
  const submitted = a.status === "submitted";
  return (
    <>
      {header}
      <div className="mb-4 space-y-2">
        <Notice tone={submitted ? "ok" : "neutral"}>
          {submitted ? (
            <>
              Submitted {a.submittedAt ? formatDateTime(a.submittedAt) : ""}. It&apos;s locked; the plan owner or an admin can reopen it for corrections.{" "}
              <Link href={`/interviews/${kit.id}/debrief`} className="font-medium underline">
                Open the debrief
              </Link>
            </>
          ) : (
            <>
              <strong>{stage.name}</strong>
              {stage.purpose ? ` — ${stage.purpose}` : ""}. Complete this independently: you won&apos;t see other interviewers&apos; feedback until you submit. Drafts are private to you.
            </>
          )}
        </Notice>
        {stage.scheduledAt && (
          <p className="text-[12.5px] text-muted">
            Scheduled {formatDateTime(stage.scheduledAt)}
            {stage.durationMins ? ` · ${stage.durationMins} min` : ""}
            {stage.locationNote ? ` · ${stage.locationNote}` : ""} (entered manually by the recruiter)
          </p>
        )}
      </div>
      {competencies.length === 0 ? (
        <EmptyState title="No competencies assigned to this stage" body="Ask the recruiter to choose competencies for this stage." />
      ) : (
        <ScorecardForm
          assignmentId={a.id}
          competencies={competencies}
          entries={parseEntries(a.entriesJson)}
          questionNotes={JSON.parse(a.questionNotesJson)}
          notes={a.notes}
          readOnly={submitted}
        />
      )}
    </>
  );
}
