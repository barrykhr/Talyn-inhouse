import { auditAccess } from "@/lib/audit";
import clsx from "clsx";
import Link from "next/link";
import { ActionButton } from "@/components/client";
import { StageSelect } from "@/components/stage-select";
import { ScorePanel } from "@/components/score-panel";
import { SourceRef } from "@/components/source-ref";
import { SourceViewerProvider } from "@/components/source-viewer";
import { StatusLine, type StatusItem } from "@/components/status-line";
import { SummaryLine } from "@/components/summary";
import { ReviewPanelShell, Tabs } from "@/components/workspace";
import { Badge, Card, EmptyState, Notice, PageHeader, SectionTitle, formatDate, formatDateTime } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CORRECTION_REASON_LABEL, DECISION_LABEL, ORIGIN_LABEL, RECOMMENDATION_LABEL, STAGE_LABEL, type Decision, type Recommendation, type Stage } from "@/lib/domain";
import { pct } from "@/lib/score";
import { computeScore } from "@/lib/score";
import { roleFit, stageReadiness } from "@/lib/ranking";
import { parseEvidence } from "@/lib/evidence";
import { highlight } from "@/lib/highlight";
import { isStale, summarize } from "@/lib/summary";
import { deleteAssessment } from "@/server/assessment-actions";
import { extractFromCurrentResume, removeFromRole } from "@/server/candidate-actions";
import { parseOrigins } from "@/server/resume-store";
import { ownCandidate } from "@/server/scope";
import { ActivityList, parseMeta } from "@/components/activity";
import { AddToRole } from "./add-role";
import { GeneratorTag, ItemCard, RecommendationPanel, ReviewControls, RunAssessment, StaleNotice, type ItemView } from "./assessment";
import { CV_LISTS, CV_SCALARS } from "@/lib/extraction-fields";
import { CvReviewForm, type CvFact } from "./cv-review";
import { DecisionForm } from "./decision";
import { TasksCard } from "./tasks";
import { OutreachPanel, type OutreachView } from "./outreach";
import { SENDING_SETUP_HINT } from "@/lib/outreach/provider";
import { DeleteCandidateButton, DeleteResumeButton, EditProfile, NoteForm, NoteItem, ResumeUpload } from "./panels";

// AI proposals/assessments run as server actions on this page and can take a while.
export const maxDuration = 300;

export const metadata = { title: "Candidate" };

export default async function CandidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string; resumeError?: string; notice?: string; saved?: string; view?: string }>;
}) {
  const auth = await requireAuth();
  const { id } = await params;
  const { role: roleParam, resumeError, notice, saved, view } = await searchParams;
  await ownCandidate(auth, id);
  await auditAccess(auth, "candidate.viewed", { subjectType: "candidate", subjectId: id, candidateId: id });

  const candidate = await db.candidate.findFirstOrThrow({
    where: { id, orgId: auth.orgId },
    include: {
      resumes: { orderBy: { createdAt: "desc" } },
      extracted: { where: { status: { not: "rejected" } }, orderBy: { position: "asc" } },
      notes: { orderBy: { createdAt: "desc" } },
      applications: {
        include: {
          role: { include: { criteria: { where: { status: "approved" }, select: { id: true, updatedAt: true } } } }, // criteriaVersion on role
          stageEvents: { orderBy: { createdAt: "desc" } },
          tasks: { where: { status: "open" }, orderBy: { createdAt: "asc" } },
          assessments: { orderBy: { createdAt: "desc" }, include: { items: true, resume: { select: { fileName: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const activity = await db.auditEvent.findMany({ where: { orgId: auth.orgId, candidateId: id }, orderBy: { createdAt: "desc" }, take: 60 });
  const allRoles = await db.role.findMany({ where: { orgId: auth.orgId }, select: { id: true, title: true, status: true }, orderBy: { title: "asc" } });

  const app = candidate.applications.find((a) => a.roleId === roleParam) ?? candidate.applications[0];
  const latest = app?.assessments[0];
  const earlier = app?.assessments.slice(1) ?? [];
  const resume = candidate.resumes.find((r) => r.isCurrent) ?? candidate.resumes[0];
  const pages = resume ? (JSON.parse(resume.pagesJson) as string[]) : [];
  const ai = aiStatus();
  const facts: CvFact[] = candidate.extracted.map((f) => ({
    id: f.id,
    field: f.field,
    value: JSON.parse(f.valueJson),
    editedValue: f.editedValueJson ? JSON.parse(f.editedValueJson) : null,
    sourceQuote: f.sourceQuote,
    sourcePage: f.sourcePage,
    sourceSection: f.sourceSection,
    verified: f.verified,
    extractor: f.extractor,
    status: f.status,
    createdAt: f.createdAt.toISOString(),
    correctionReason: f.correctionReason,
  }));
  const pendingFacts = facts.filter((f) => f.status === "pending");
  const reviewedFacts = facts.filter((f) => f.status !== "pending");
  const needsReview = candidate.extractionStatus === "needs_review";
  const origins = parseOrigins(candidate.fieldOriginsJson);
  const liveScore = latest
    ? computeScore(latest.items.map((i) => ({ name: i.criterionName, importance: i.importance, result: i.result, overrideResult: i.overrideResult })))
    : null;
  const recJson = (latest?.recommendationJson ? JSON.parse(latest.recommendationJson) : {}) as {
    rationale?: string;
    criteriaCited?: string[];
    questions?: string[];
    adjustedNote?: string | null;
    unavailable?: string;
  };

  const items: ItemView[] = (latest?.items ?? []).map((i) => ({
    ...i,
    evidence: parseEvidence(i.evidenceJson),
    overriddenAt: i.overriddenAt?.toISOString() ?? null,
  }));
  const resumeQuotes = items.flatMap((i) => i.evidence.filter((e) => e.source === "resume" && e.verified).map((e) => e.quote));
  const profileQuotes = items.flatMap((i) => i.evidence.filter((e) => e.source === "profile" && e.verified).map((e) => e.quote));
  const roleTitles = new Map(allRoles.map((r) => [r.id, r.title]));
  const availableRoles = allRoles.filter((r) => r.status !== "closed" && !candidate.applications.some((a) => a.roleId === r.id));

  const disabledReason = !app
    ? undefined
    : app.role.criteria.length === 0
      ? "This role has no approved criteria yet. Approve criteria on the role page first."
      : pages.join("").trim() === "" && !candidate.candidateSummary
        ? "Add a resume or candidate-provided information before assessing."
        : undefined;

  const stale = !!latest && (isStale(latest.criteriaSnapshot, app!.role.criteria) || (latest.criteriaVersion != null && latest.criteriaVersion !== app!.role.criteriaVersion));
  const stageSince = app?.stageEvents[0]?.createdAt ?? app?.createdAt;
  const [sequences, templates] = app
    ? await Promise.all([
        db.outreachSequence.findMany({
          where: { orgId: auth.orgId, applicationId: app.id },
          orderBy: { createdAt: "desc" },
          take: 3,
          include: { messages: { orderBy: { step: "asc" } }, events: { orderBy: { createdAt: "desc" }, take: 40 } },
        }),
        db.outreachTemplate.findMany({ where: { orgId: auth.orgId }, select: { id: true, name: true }, orderBy: { updatedAt: "desc" }, take: 30 }),
      ])
    : [[], []];
  const seq = sequences.find((x) => ["draft", "active", "paused"].includes(x.status)) ?? sequences[0] ?? null;
  const outreach: OutreachView | null = app
    ? {
        applicationId: app.id,
        email: candidate.email,
        emailOrigin: candidate.email ? (ORIGIN_LABEL[origins.email ?? (candidate.source === "csv" ? "" : "recruiter")] ?? (candidate.source === "csv" ? "CSV import" : null)) : null,
        optedOut: candidate.contactOptOut,
        aiConfigured: ai.configured,
        sendingHint: SENDING_SETUP_HINT,
        templates,
        sequence: seq && {
          id: seq.id,
          status: seq.status,
          stopReason: seq.stopReason,
          activatedByName: seq.activatedByName,
          messages: seq.messages.map((m) => ({
            id: m.id,
            step: m.step,
            delayDays: m.delayDays,
            subject: m.subject,
            body: m.body,
            edited: m.subject !== m.draftSubject || m.body !== m.draftBody,
            personalization: JSON.parse(m.personalizationJson),
            generator: m.generator,
            status: m.status,
            approvedByName: m.approvedByName,
            dueAt: m.dueAt?.toISOString() ?? null,
            sentAt: m.sentAt?.toISOString() ?? null,
            sentVia: m.sentVia,
          })),
          events: seq.events.map((e) => ({ id: e.id, type: e.type, actorName: e.actorName, providerConfirmed: e.providerConfirmed, note: e.note, createdAt: e.createdAt.toISOString() })),
        },
      }
    : null;
  const fit = app ? roleFit(app.assessments, { criteria: app.role.criteria, criteriaVersion: app.role.criteriaVersion }) : null;
  const readiness = app
    ? stageReadiness({
        stage: app.stage,
        hasCv: !!resume,
        profileReviewed: !needsReview,
        assessment: latest ?? null,
        assessmentCurrent: !!latest && !stale,
        openRequests: app.tasks.filter((t) => t.type === "gather_info").length,
        decision: app.decision,
      })
    : null;
  const profileText = [candidate.currentTitle ? `Current title: ${candidate.currentTitle}` : "", candidate.currentCompany ? `Current company: ${candidate.currentCompany}` : "", candidate.candidateSummary ?? ""].filter(Boolean).join("\n");

  // What Talyn has done, what needs review, and the next available action — most important first.
  const status: StatusItem[] = [];
  if (needsReview) status.push({ tone: "attention", text: "Details extracted from the CV are waiting for your review", href: "#cv-review", action: "Review" });
  if (app) {
    if (!latest) {
      if (app.role.criteria.length === 0) status.push({ tone: "neutral", text: `${app.role.title} has no approved criteria yet`, href: `/roles/${app.roleId}?tab=criteria`, action: "Set up criteria" });
      else status.push({ tone: "neutral", text: `Not yet assessed against ${app.role.criteria.length} criteria for ${app.role.title}` });
    } else {
      if (stale) status.push({ tone: "attention", text: "The role's criteria changed since this assessment — re-run it to update" });
      if (latest.status !== "reviewed") status.push({ tone: "ai", text: "Assessment drafted — review the evidence" });
      if (latest.recommendation && latest.recommendationStatus === "pending") status.push({ tone: "ai", text: "AI recommendation awaiting your review" });
      if (app.tasks.length) status.push({ tone: "attention", text: `${app.tasks.length} open information request${app.tasks.length > 1 ? "s" : ""}` });
      if (!app.decision) status.push({ tone: "attention", text: "Choose Advance, Hold or Decline" });
    }
    if (status.length === 0)
      status.push({ tone: "ok", text: `Up to date · ${app.decision ? `Decision: ${DECISION_LABEL[app.decision as Decision]}` : "No decision yet"} · Stage: ${STAGE_LABEL[app.stage as Stage]}` });
  }

  const contactMeta = (
    <>
      {(candidate.currentTitle || candidate.currentCompany) && <span className="text-ink-2">{[candidate.currentTitle, candidate.currentCompany].filter(Boolean).join(" · ")}</span>}
      {candidate.location && <span>{candidate.location}</span>}
      {candidate.email && (
        <a className="hover:text-ink" href={`mailto:${candidate.email}`}>
          {candidate.email}
        </a>
      )}
      {candidate.phone && <span>{candidate.phone}</span>}
      {candidate.linkedinUrl && (
        <a className="hover:text-ink" href={candidate.linkedinUrl} target="_blank" rel="noopener noreferrer nofollow">
          LinkedIn ↗
        </a>
      )}
    </>
  );

  // ---------------------------------------------------------------- tab: CV & profile
  const cvProfile = (
    <div className="grid gap-5 xl:grid-cols-2">
      <div className="space-y-5">
        <Card className="p-4">
          <SectionTitle hint="Where each detail came from.">Profile</SectionTitle>
          <dl className="space-y-1.5 text-[13px]">
            {CV_SCALARS.map(({ label, column }) => {
              const v = (candidate as Record<string, unknown>)[column] as string | null;
              if (!v || (column === "fullName" && candidate.source === "cv_upload" && v.startsWith("Unnamed candidate"))) return null;
              const o: string = origins[column] ?? (candidate.source === "csv" ? "csv" : "recruiter");
              return (
                <div key={column} className="flex flex-wrap items-baseline justify-between gap-x-2">
                  <dt className="text-muted">{label}</dt>
                  <dd className="flex min-w-0 items-baseline gap-1.5 text-right">
                    <span className="truncate">{v}</span>
                    <span className={clsx("shrink-0 text-[11px]", o === "cv_corrected" ? "text-warn" : "text-faint")}>{o === "csv" ? "CSV import" : (ORIGIN_LABEL[o] ?? o)}</span>
                  </dd>
                </div>
              );
            })}
          </dl>
        </Card>

        {(reviewedFacts.some((f) => CV_LISTS.some((g) => g.field === f.field)) || (resume && !needsReview && facts.length === 0)) && (
          <Card className="p-4">
            <SectionTitle hint="Extracted from the CV and reviewed by a recruiter.">CV details</SectionTitle>
            {facts.length === 0 && resume ? (
              <div className="text-[13px] text-muted">
                No details have been extracted from this resume yet.
                <div className="mt-2">
                  <ActionButton action={extractFromCurrentResume.bind(null, candidate.id)} pendingLabel="Extracting…">
                    Extract details from CV
                  </ActionButton>
                </div>
              </div>
            ) : (
              <div className="space-y-3">
                {CV_LISTS.map((g) => {
                  const list = reviewedFacts.filter((f) => f.field === g.field);
                  if (!list.length) return null;
                  return (
                    <div key={g.field}>
                      <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{g.label}</div>
                      <ul className="space-y-1.5">
                        {list.map((f) => {
                          const v = (f.status === "edited" ? f.editedValue : f.value) as Record<string, string> | string;
                          const text =
                            typeof v === "string"
                              ? v
                              : g.field === "work_history"
                                ? `${v.title}${v.employer ? ` · ${v.employer}` : ""}${v.start || v.end ? ` (${[v.start, v.end].filter(Boolean).join(" – ")})` : ""}`
                                : g.field === "education"
                                  ? [v.credential, v.field, v.institution].filter(Boolean).join(" · ")
                                  : [v.name, v.issuer].filter(Boolean).join(" · ");
                          return (
                            <li key={f.id} className="text-[13px]">
                              <span>{text}</span>
                              {f.status === "edited" && (
                                <span className="ml-1.5 text-[11px] text-warn">
                                  corrected{f.correctionReason ? ` · ${CORRECTION_REASON_LABEL[f.correctionReason] ?? f.correctionReason}` : ""}
                                </span>
                              )}
                              {f.status === "accepted" && <span className="ml-1.5 text-[11px] text-faint">confirmed by recruiter</span>}
                              <SourceRef doc="CV" quote={f.sourceQuote} page={f.sourcePage} section={f.sourceSection} verified={f.verified} extractor={f.extractor} at={f.createdAt} />
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        )}

        <Card className="p-4" id="candidate-info">
          <SectionTitle hint="Provided by the candidate; can be cited as evidence.">Candidate-provided info</SectionTitle>
          {candidate.candidateSummary ? (
            <div className="whitespace-pre-wrap text-[13px] text-ink-2">{highlight(candidate.candidateSummary, profileQuotes)}</div>
          ) : (
            <p className="text-[13px] text-faint">None. Add it via Edit profile.</p>
          )}
        </Card>
      </div>

      <Card className="p-4" id="resume">
        <SectionTitle
          action={
            resume && (
              <span className="flex items-center gap-1">
                {resume.hasFile && (
                  <a href={`/api/resumes/${resume.id}`} target="_blank" rel="noopener" className="text-[12.5px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
                    Original
                  </a>
                )}
                <DeleteResumeButton id={resume.id} />
              </span>
            )
          }
          hint={resume ? `${resume.fileName} · ${formatDate(resume.createdAt)}${pages.length > 1 ? ` · ${pages.length} pages` : ""}` : undefined}
        >
          CV
        </SectionTitle>
        {resume ? (
          <div className="max-h-[640px] space-y-3 overflow-y-auto rounded-lg bg-[#fbfaf7] p-3">
            {pages.map((p, i) => (
              <div key={i} id={`resume-p${i + 1}`}>
                {pages.length > 1 && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Page {i + 1}</div>}
                <div className="resume-text text-ink-2">{highlight(p, resumeQuotes)}</div>
              </div>
            ))}
            {pages.join("").trim() === "" && <p className="text-[13px] text-faint">No text could be extracted.</p>}
          </div>
        ) : (
          <p className="mb-3 text-[13px] text-muted">No CV yet.</p>
        )}
        <div className="mt-3">
          <ResumeUpload candidateId={candidate.id} hasResume={!!resume} />
        </div>
        {candidate.resumes.length > 1 && <p className="mt-2 text-[12px] text-faint">{candidate.resumes.length - 1} earlier version(s) kept.</p>}
      </Card>
    </div>
  );

  // ---------------------------------------------------------------- tab: notes & history
  const activityCardSlot = (
    <Card className="p-4 xl:col-span-2">
      <SectionTitle hint="Who viewed, downloaded, assessed, decided or changed this candidate. Views are recorded at most every 30 minutes per person.">Activity</SectionTitle>
      <ActivityList rows={activity.map((a) => ({ id: a.id, action: a.action, actorName: a.actorName, createdAt: a.createdAt, meta: parseMeta(a.metaJson) }))} />
    </Card>
  );
  const notesHistory = (
    <div className="grid gap-5 xl:grid-cols-2">
      <Card className="p-4">
        <SectionTitle hint="Internal only. Never used as assessment evidence.">Notes</SectionTitle>
        <NoteForm candidateId={candidate.id} roles={candidate.applications.map((a) => ({ id: a.roleId, title: a.role.title }))} />
        {candidate.notes.length > 0 && (
          <ul className="mt-2 divide-y divide-line">
            {candidate.notes.map((n) => (
              <NoteItem
                key={n.id}
                note={{ id: n.id, body: n.body, authorName: n.authorName, createdAt: n.createdAt.toISOString(), roleTitle: n.roleId ? (roleTitles.get(n.roleId) ?? null) : null }}
              />
            ))}
          </ul>
        )}
      </Card>
      {app && (
        <Card className="p-4">
          <SectionTitle
            action={
              <ActionButton
                action={removeFromRole.bind(null, app.id)}
                variant="ghost"
                confirm={`Remove ${candidate.fullName} from ${app.role.title}? Their assessments for this role are deleted.`}
              >
                Remove from role
              </ActionButton>
            }
          >
            Stage history · {app.role.title}
          </SectionTitle>
          <ol className="space-y-1.5 border-l border-line pl-4 text-[13px]">
            {app.stageEvents.map((e) => (
              <li key={e.id} className="relative">
                <span className="absolute -left-[19.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-line-strong" />
                {e.fromStage ? (
                  <>
                    {STAGE_LABEL[e.fromStage as Stage]} → <span className="font-medium">{STAGE_LABEL[e.toStage as Stage]}</span>
                  </>
                ) : (
                  <>
                    Added as <span className="font-medium">{STAGE_LABEL[e.toStage as Stage]}</span>
                  </>
                )}
                <span className="text-faint">
                  {" "}
                  · {e.actorName || "Unknown"} · {formatDateTime(e.createdAt)}
                </span>
              </li>
            ))}
          </ol>
          {earlier.length > 0 && (
            <div className="mt-5">
              <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Earlier assessments</div>
              <ul className="divide-y divide-line text-[13px]">
                {earlier.map((a) => (
                  <li key={a.id} className="flex flex-wrap items-center gap-3 py-2">
                    <GeneratorTag generator={a.generator} model={a.model} />
                    <span className="text-[12px] text-muted">{formatDateTime(a.createdAt)}</span>
                    <SummaryLine summary={summarize(a.items)} compact />
                    <span className="ml-auto">
                      <ActionButton action={deleteAssessment.bind(null, a.id)} variant="ghost" confirm="Delete this earlier assessment?">
                        Delete
                      </ActionButton>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
      {activityCardSlot}
    </div>
  );

  // ---------------------------------------------------------------- tab: assessment (evidence)
  const assessmentMain = app && (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-[15px] font-semibold tracking-tight">Evidence against {app.role.criteria.length} approved criteria</h2>
          <p className="mt-0.5 text-[13px] text-muted">From the CV and candidate-provided information. Open any citation to see it in context.</p>
        </div>
        <RunAssessment applicationId={app.id} aiConfigured={ai.configured} hasAssessment={!!latest} disabledReason={disabledReason} />
      </div>
      {!latest ? (
        <EmptyState title="Not assessed yet" body="Talyn checks each approved criterion against the CV and shows the evidence, what's missing, and what is only inferred. You review and decide." />
      ) : (
        <>
          {stale && <StaleNotice />}
          <Card className="overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-[#fbfaf8] px-4 py-3">
              <GeneratorTag generator={latest.generator} model={latest.model} />
              <span className="text-[12px] text-muted">{formatDateTime(latest.createdAt)}</span>
              <span className="ml-auto">
                <ReviewControls assessmentId={latest.id} reviewed={latest.status === "reviewed"} reviewedBy={latest.reviewedByName} />
              </span>
            </div>
            <div className="border-b border-line px-4 py-2.5">
              <SummaryLine summary={summarize(latest.items)} />
            </div>
            <div className="divide-y divide-line">
              {items.map((i) => (
                <ItemCard key={i.id} item={i} />
              ))}
            </div>
            <div className="border-t border-line px-4 py-2 text-[11.5px] text-faint">
              Criteria v{latest.criteriaVersion ?? "?"}
              {latest.criteriaVersion != null && latest.criteriaVersion !== app.role.criteriaVersion && ` (current v${app.role.criteriaVersion})`} · CV:{" "}
              {latest.resume ? latest.resume.fileName : "none"}
              {latest.parserVersion ? ` (${latest.parserVersion})` : ""} · Engine: {latest.engineVersion ?? "assess-v1"}
            </div>
          </Card>
        </>
      )}
    </div>
  );

  // ---------------------------------------------------------------- right panel: score → recommendation → decision
  const panel = app && (
    <>
      <Card className="p-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <Link href={`/roles/${app.roleId}`} className="font-semibold tracking-tight hover:underline">
              {app.role.title}
            </Link>
            {stageSince && <div className="text-[12px] text-muted">In {STAGE_LABEL[app.stage as Stage].toLowerCase()} since {formatDate(stageSince)}</div>}
          </div>
          <StageSelect applicationId={app.id} stage={app.stage} />
        </div>
        <div className="mt-3 grid grid-cols-2 gap-3 border-t border-line pt-3 text-[12.5px]">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Role fit</div>
            {fit && fit.state !== "unranked" ? (
              <div>
                <span className="font-semibold tabular-nums">{fit.score}</span>
                <span className="text-faint">/100</span>
                {fit.state === "low_confidence" && <span className="text-warn"> · low confidence</span>}
              </div>
            ) : (
              <div className="text-muted">Unranked</div>
            )}
            <div className="text-[11.5px] text-muted">{fit?.reason}</div>
            {fit?.change && <div className="text-[11.5px] text-ink-2">Changed {fit.change}</div>}
          </div>
          {readiness && (
            <details>
              <summary className="cursor-pointer list-none">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Readiness</div>
                <span className="font-semibold tabular-nums">{readiness.met}</span>
                <span className="text-faint">/{readiness.total}</span>
                <div className="text-[11.5px] text-muted">for {readiness.nextDecision}</div>
              </summary>
              <ul className="mt-1 space-y-0.5 text-[11.5px]">
                {readiness.checks.map((c) => (
                  <li key={c.label} className={c.met ? "text-ok" : "text-muted"}>
                    {c.met ? "✓" : "○"} {c.label}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </div>
      </Card>

      <Card className="p-4">
        <div className="mb-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Score</div>
        {liveScore ? (
          <ScorePanel score={liveScore} adjusted={summarize(latest!.items).overrides > 0} />
        ) : (
          <p className="text-[13px] text-muted">Appears after an assessment, with its calculation and evidence coverage.</p>
        )}
      </Card>

      <Card className="p-4" aria-live="polite">
        <div className="mb-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Recommendation</div>
        {latest ? (
          <div key={`${latest.id}:${latest.recommendationStatus}`} className="motion-fade">
            <RecommendationPanel
              r={{
                assessmentId: latest.id,
                applicationId: app.id,
                openRequests: app.tasks.length,
                recommendation: latest.recommendation,
                rationale: recJson.rationale ?? null,
                criteriaCited: recJson.criteriaCited ?? [],
                questions: recJson.questions ?? [],
                adjustedNote: recJson.adjustedNote ?? null,
                unavailable: recJson.unavailable ?? null,
                status: latest.recommendationStatus,
                finalRecommendation: latest.finalRecommendation,
                note: latest.recommendationNote,
                reviewedBy: latest.recommendationReviewedBy,
              }}
            />
          </div>
        ) : (
          <p className="text-[13px] text-muted">Shown after the score, for you to accept, edit or override.</p>
        )}
      </Card>

      <Card className="p-4">
        <div className="mb-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Information requests</div>
        <TasksCard
          applicationId={app.id}
          suggested={recJson.questions ?? []}
          tasks={app.tasks.map((t) => ({
            id: t.id,
            title: t.title,
            questions: (JSON.parse(t.detailsJson) as { questions?: string[] }).questions ?? [],
            dueAt: t.dueAt?.toISOString() ?? null,
            createdByName: t.createdByName,
            createdAt: t.createdAt.toISOString(),
          }))}
        />
      </Card>

      <Card className="p-4">
        <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Your decision</div>
        <p className="mb-3 text-[12.5px] text-muted">
          {latest && !app.decision ? "The assessment is ready. Choose Advance, Hold or Decline — Talyn won't choose for you." : "Recorded separately from the pipeline stage and from any AI output."}
        </p>
        <DecisionForm applicationId={app.id} decision={app.decision} note={app.decisionNote} />
        {app.decidedAt && (
          <p className="mt-2 text-[12px] text-faint">
            Last recorded {formatDateTime(app.decidedAt)}
            {app.decidedByName ? ` by ${app.decidedByName}` : ""}
          </p>
        )}
      </Card>
    </>
  );

  const panelSummary = app ? (
    <>
      {liveScore ? (liveScore.score === null ? "Score withheld" : `Alignment ${liveScore.score}/100`) : "Not assessed"}
      {liveScore && ` · coverage ${pct(liveScore.coverage)}`}
      {latest?.recommendation && ` · ${RECOMMENDATION_LABEL[(latest.finalRecommendation ?? latest.recommendation) as Recommendation]}`}
    </>
  ) : null;

  return (
    <SourceViewerProvider pages={pages} profileText={profileText} fileName={resume?.fileName ?? null}>
      <PageHeader
        eyebrow={<Link href="/candidates" className="hover:text-ink">Candidates</Link>}
        title={candidate.fullName}
        meta={contactMeta}
        actions={
          <>
            <EditProfile
              candidateId={candidate.id}
              values={{
                fullName: candidate.fullName,
                email: candidate.email,
                phone: candidate.phone,
                location: candidate.location,
                linkedinUrl: candidate.linkedinUrl,
                currentTitle: candidate.currentTitle,
                currentCompany: candidate.currentCompany,
                candidateSummary: candidate.candidateSummary,
              }}
            />
            <DeleteCandidateButton id={candidate.id} name={candidate.fullName} />
          </>
        }
      />

      {resumeError && <Notice tone="danger" className="mb-4">Candidate saved, but the resume couldn&apos;t be processed: {resumeError}</Notice>}
      {notice && <Notice tone="warn" className="mb-4">{notice}</Notice>}
      {saved === "profile" && !needsReview && (
        <Notice tone="ok" className="mb-4">Profile saved from your review. CV-extracted details are labeled with their source; your corrections are marked.</Notice>
      )}

      <StatusLine items={status} />

      {needsReview && (
        <div id="cv-review" className="mb-6 scroll-mt-6">
          <CvReviewForm
            candidateId={candidate.id}
            facts={pendingFacts}
            current={Object.fromEntries(CV_SCALARS.map((f) => [f.column, (candidate as Record<string, unknown>)[f.column] as string | null]))}
          />
        </div>
      )}

      <nav aria-label="Roles for this candidate" className="mb-4 flex flex-wrap items-center gap-1.5">
        {candidate.applications.map((a) => (
          <Link
            key={a.id}
            href={`/candidates/${candidate.id}?role=${a.roleId}`}
            aria-current={a.id === app?.id ? "page" : undefined}
            className={clsx(
              "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium transition-colors",
              a.id === app?.id ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken",
            )}
          >
            {a.role.title}
            <span className={clsx("text-[11.5px] font-normal", a.id === app?.id ? "text-white/70" : "text-muted")}>{STAGE_LABEL[a.stage as Stage]}</span>
          </Link>
        ))}
        <AddToRole candidateId={candidate.id} roles={availableRoles} />
      </nav>

      {!app ? (
        <>
          <EmptyState className="mb-6" title="Not in any role yet" body="Add this candidate to a role to assess them against its approved criteria and move them through its pipeline." />
          <Tabs tabs={[{ label: "CV & profile", content: cvProfile }, { label: "Notes & activity", count: candidate.notes.length, content: notesHistory }]} />
        </>
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="min-w-0">
            <Tabs
              initial={view === "outreach" ? 1 : 0}
              tabs={[
                { label: "Assessment", content: assessmentMain },
                { label: "Outreach", content: outreach ? <OutreachPanel v={outreach} /> : null },
                { label: "CV & profile", content: cvProfile },
                { label: "Notes & activity", count: candidate.notes.length, content: notesHistory },
              ]}
            />
          </div>
          <ReviewPanelShell summary={panelSummary}>{panel}</ReviewPanelShell>
        </div>
      )}
    </SourceViewerProvider>
  );
}
