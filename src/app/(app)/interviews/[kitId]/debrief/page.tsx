import clsx from "clsx";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge, Card, EmptyState, Notice, SectionTitle, formatDateTime } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadKitForUser } from "@/lib/interviews/access";
import { DECISION_LABEL, RATING_LABEL, agreement, parseEntries, type Rating } from "@/lib/interviews/rubric";
import { KitHeader } from "../../kit-header";
import { CommentForm, DecisionForm } from "./debrief-forms";

export const metadata = { title: "Debrief" };

const AGREE_TONE = { none: "text-faint", single: "text-muted", aligned: "text-ok", mixed: "text-ink-2", disagree: "text-danger" } as const;

/** Debrief: submitted evidence by competency, where interviewers agree or not, gaps, discussion, human decision. */
export default async function DebriefPage({ params, searchParams }: { params: Promise<{ kitId: string }>; searchParams: Promise<{ submitted?: string }> }) {
  const auth = await requireAuth();
  const { kitId } = await params;
  const { submitted } = await searchParams;
  const v = await loadKitForUser(auth, kitId);
  if (!v) notFound();
  const { kit } = v;
  const header = (
    <KitHeader
      kitId={kit.id}
      candidate={kit.application.candidate}
      role={kit.application.role}
      status={kit.status}
      active="debrief"
      myScorecards={kit.status === "shared" ? v.mine.map((m) => ({ id: m.id, stage: kit.stages.find((s) => s.id === m.stageId)?.name ?? "Stage", status: m.status })) : []}
      decision={kit.decision}
    />
  );

  // Independence: interviewers who haven't submitted can't see anyone else's feedback.
  if (!v.canSeeFeedback)
    return (
      <>
        {header}
        <EmptyState
          title="Submit your scorecard first"
          body="To keep feedback independent, the debrief opens for you after you submit your own scorecard."
          action={
            <Link href={`/interviews/${kit.id}/scorecard/${v.pendingMine[0].id}`} className="font-medium underline">
              Go to your scorecard
            </Link>
          }
        />
      </>
    );

  const assignments = kit.stages.flatMap((s) => s.assignments.map((a) => ({ ...a, stageName: s.name, competencyIds: JSON.parse(s.competencyIdsJson) as string[] })));
  const subs = assignments.filter((a) => a.status === "submitted").map((a) => ({ ...a, entries: parseEntries(a.entriesJson) }));
  const pendingList = assignments.filter((a) => a.status !== "submitted");
  const comments = await db.debriefComment.findMany({ where: { kitId }, orderBy: { createdAt: "asc" } });
  const qText = new Map(kit.competencies.flatMap((c) => c.questions.map((q) => [q.id, q.text] as const)));

  const rows = kit.competencies.map((c) => {
    const scored = subs.flatMap((s) => s.entries.filter((e) => e.competencyId === c.id).map((e) => ({ ...e, who: s.interviewerName, stage: s.stageName, at: s.submittedAt })));
    const ratings = scored.filter((e) => e.rating).map((e) => e.rating as number);
    const notAssessed = scored.filter((e) => e.notAssessed);
    const assignedTo = assignments.filter((a) => a.competencyIds.includes(c.id));
    return { c, scored, ratings, notAssessed, agree: agreement(ratings), awaiting: assignedTo.filter((a) => a.status !== "submitted").map((a) => a.interviewerName) };
  });
  const disagreements = rows.filter((r) => r.agree.kind === "disagree");
  const gaps = rows.filter((r) => r.ratings.length === 0);

  return (
    <>
      {header}
      {submitted && <Notice tone="ok" className="mb-4">Scorecard submitted. You can now see the other submitted feedback.</Notice>}

      <Card className="mb-5 grid gap-3 p-4 text-[13px] sm:grid-cols-3">
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Scorecards</div>
          <div>
            {subs.length} of {assignments.length} submitted
          </div>
          {pendingList.length > 0 && <div className="text-[12px] text-warn">Waiting on {pendingList.map((p) => `${p.interviewerName} (${p.stageName})`).join(", ")}</div>}
        </div>
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Disagreements</div>
          <div>{disagreements.length ? disagreements.map((r) => r.c.name).join(" · ") : "None — ratings within one level"}</div>
        </div>
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">No evidence yet</div>
          <div>{gaps.length ? gaps.map((r) => r.c.name).join(" · ") : "Every competency has at least one rating"}</div>
        </div>
      </Card>

      {subs.length === 0 ? (
        <EmptyState className="mb-6" title="No submitted scorecards yet" body={kit.status === "shared" ? "Feedback appears here as interviewers submit." : "Share the plan so interviewers can open their scorecards."} />
      ) : (
        <section className="mb-6 space-y-3" aria-labelledby="ev-h">
          <SectionTitle hint="Each rating is shown with its evidence and who gave it. There's no overall score — discuss the evidence, then decide.">
            <span id="ev-h">Evidence by competency</span>
          </SectionTitle>
          {rows.map(({ c, scored, ratings, notAssessed, agree, awaiting }) => (
            <Card key={c.id} className="overflow-hidden">
              <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#fbfaf8] px-4 py-2.5">
                <h3 className="font-medium">{c.name}</h3>
                {c.origin === "recruiter" && <Badge tone="warn">Added by recruiter</Badge>}
                <span className={clsx("text-[12.5px] font-medium", AGREE_TONE[agree.kind])}>{agree.label}</span>
                <span className="ml-auto flex gap-1" aria-label={`Ratings: ${ratings.join(", ") || "none"}`}>
                  {[1, 2, 3, 4].map((l) => (
                    <span key={l} className="flex flex-col items-center text-[10.5px] text-faint">
                      <span className={clsx("flex h-6 w-6 items-center justify-center rounded-md text-[12px] font-semibold", ratings.filter((x) => x === l).length ? "bg-ink text-white" : "bg-sunken text-faint")}>
                        {ratings.filter((x) => x === l).length || ""}
                      </span>
                      {l}
                    </span>
                  ))}
                </span>
              </div>
              <ul className="divide-y divide-line">
                {scored
                  .filter((e) => e.rating)
                  .map((e, i) => (
                    <li key={i} className="px-4 py-2.5 text-[13px]">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-medium">{e.who}</span>
                        <span className="text-muted">· {e.stage}</span>
                        <Badge>
                          {e.rating} · {RATING_LABEL[e.rating as Rating]}
                        </Badge>
                        {e.at && <span className="ml-auto text-[11.5px] text-faint">submitted {formatDateTime(e.at)}</span>}
                      </div>
                      <p className="mt-1 whitespace-pre-wrap text-ink-2">{e.evidence || <span className="text-faint">No evidence written</span>}</p>
                    </li>
                  ))}
                {notAssessed.length > 0 && <li className="px-4 py-2 text-[12.5px] text-muted">Not assessed by {notAssessed.map((e) => e.who).join(", ")}</li>}
                {awaiting.length > 0 && <li className="px-4 py-2 text-[12.5px] text-faint">Waiting on {awaiting.join(", ")}</li>}
                {scored.length === 0 && awaiting.length === 0 && <li className="px-4 py-2 text-[12.5px] text-faint">No interviewer was assigned this competency.</li>}
              </ul>
            </Card>
          ))}
        </section>
      )}

      {subs.some((s) => s.notes || Object.keys(JSON.parse(s.questionNotesJson)).length) && (
        <section className="mb-6" aria-labelledby="notes-h">
          <SectionTitle hint="Visible to the team after each interviewer submits.">
            <span id="notes-h">Interviewer notes</span>
          </SectionTitle>
          <Card className="divide-y divide-line">
            {subs.map((s) => {
              const qn = JSON.parse(s.questionNotesJson) as Record<string, string>;
              if (!s.notes && !Object.keys(qn).length) return null;
              return (
                <div key={s.id} className="px-4 py-3 text-[13px]">
                  <div className="font-medium">
                    {s.interviewerName} <span className="font-normal text-muted">· {s.stageName}</span>
                  </div>
                  {Object.entries(qn).map(([qid, note]) => (
                    <p key={qid} className="mt-1">
                      <span className="text-muted">{qText.get(qid) ?? "Question"}: </span>
                      {note}
                    </p>
                  ))}
                  {s.notes && <p className="mt-1 whitespace-pre-wrap text-ink-2">{s.notes}</p>}
                </div>
              );
            })}
          </Card>
        </section>
      )}

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section aria-labelledby="disc-h">
          <SectionTitle>
            <span id="disc-h">Team discussion</span>
          </SectionTitle>
          <Card className="p-4">
            {comments.length === 0 ? (
              <p className="mb-3 text-[13px] text-faint">No comments yet.</p>
            ) : (
              <ol className="mb-4 space-y-3">
                {comments.map((cm) => (
                  <li key={cm.id} className={clsx("text-[13px]", cm.kind.startsWith("decision") && "rounded-lg bg-sunken/70 p-2.5")}>
                    <div className="text-[12px] text-muted">
                      <span className="font-medium text-ink-2">{cm.authorName}</span> · {formatDateTime(cm.createdAt)}
                      {cm.kind.startsWith("decision:") && <> · recorded decision: <strong>{DECISION_LABEL[cm.kind.slice(9) as keyof typeof DECISION_LABEL]}</strong></>}
                    </div>
                    <p className="mt-0.5 whitespace-pre-wrap">{cm.body}</p>
                  </li>
                ))}
              </ol>
            )}
            <CommentForm kitId={kit.id} />
          </Card>
        </section>

        <section aria-labelledby="dec-h">
          <SectionTitle hint="Made and saved by a person. Talyn doesn't recommend or pick an outcome from the ratings.">
            <span id="dec-h">Team decision</span>
          </SectionTitle>
          <Card className="p-4">
            {kit.decision && (
              <p className="mb-3 text-[13px]">
                <strong>{DECISION_LABEL[kit.decision as keyof typeof DECISION_LABEL]}</strong> — recorded by {kit.decidedByName} {kit.decidedAt ? formatDateTime(kit.decidedAt) : ""}
              </p>
            )}
            {v.canDecide ? (
              <DecisionForm kitId={kit.id} current={kit.decision} rationale={kit.decisionRationale} pending={pendingList.length} />
            ) : (
              <p className="text-[13px] text-muted">Only an admin, a hiring manager, or this plan&apos;s owner ({kit.ownerName}) can record the team decision. You can still add to the discussion.</p>
            )}
            <p className="mt-3 text-[12px] text-faint">
              Separate from the scores, the shortlist decision and the pipeline stage. Move the stage on the{" "}
              <Link href={`/candidates/${kit.candidateId}?role=${kit.roleId}`} className="underline">
                candidate record
              </Link>{" "}
              when you&apos;re ready.
            </p>
          </Card>
        </section>
      </div>
    </>
  );
}
