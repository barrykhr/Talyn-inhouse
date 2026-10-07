import clsx from "clsx";
import Link from "next/link";
import { ActionButton } from "@/components/client";
import { StageSelect } from "@/components/stage-select";
import { SummaryLine } from "@/components/summary";
import { Card, EmptyState, Notice, PageHeader, SectionTitle, formatDate, formatDateTime } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECISION_LABEL, STAGE_LABEL, type Decision, type Stage } from "@/lib/domain";
import { parseEvidence } from "@/lib/evidence";
import { highlight } from "@/lib/highlight";
import { isStale, summarize } from "@/lib/summary";
import { deleteAssessment } from "@/server/assessment-actions";
import { removeFromRole } from "@/server/candidate-actions";
import { ownCandidate } from "@/server/scope";
import { AddToRole } from "./add-role";
import { GeneratorTag, ItemCard, ReviewControls, RunAssessment, StaleNotice, type ItemView } from "./assessment";
import { DecisionForm } from "./decision";
import { DeleteCandidateButton, DeleteResumeButton, EditProfile, NoteForm, NoteItem, ResumeUpload } from "./panels";

export const metadata = { title: "Candidate" };

export default async function CandidatePage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ role?: string; resumeError?: string }>;
}) {
  const auth = await requireAuth();
  const { id } = await params;
  const { role: roleParam, resumeError } = await searchParams;
  await ownCandidate(auth, id);

  const candidate = await db.candidate.findFirstOrThrow({
    where: { id, orgId: auth.orgId },
    include: {
      resumes: { orderBy: { createdAt: "desc" } },
      notes: { orderBy: { createdAt: "desc" } },
      applications: {
        include: {
          role: { include: { criteria: { where: { status: "approved" }, select: { id: true, updatedAt: true } } } },
          stageEvents: { orderBy: { createdAt: "desc" } },
          assessments: { orderBy: { createdAt: "desc" }, include: { items: true, resume: { select: { fileName: true } } } },
        },
        orderBy: { createdAt: "asc" },
      },
    },
  });
  const allRoles = await db.role.findMany({ where: { orgId: auth.orgId }, select: { id: true, title: true, status: true }, orderBy: { title: "asc" } });

  const app = candidate.applications.find((a) => a.roleId === roleParam) ?? candidate.applications[0];
  const latest = app?.assessments[0];
  const earlier = app?.assessments.slice(1) ?? [];
  const resume = candidate.resumes.find((r) => r.isCurrent) ?? candidate.resumes[0];
  const pages = resume ? (JSON.parse(resume.pagesJson) as string[]) : [];
  const ai = aiStatus();

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

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/candidates" className="hover:text-ink">Candidates</Link>}
        title={candidate.fullName}
        meta={
          <>
            {(candidate.currentTitle || candidate.currentCompany) && <span className="text-ink-2">{[candidate.currentTitle, candidate.currentCompany].filter(Boolean).join(" · ")}</span>}
            {candidate.location && <span>{candidate.location}</span>}
            {candidate.email && <a className="hover:text-ink" href={`mailto:${candidate.email}`}>{candidate.email}</a>}
            {candidate.phone && <span>{candidate.phone}</span>}
            {candidate.linkedinUrl && (
              <a className="hover:text-ink" href={candidate.linkedinUrl} target="_blank" rel="noopener noreferrer nofollow">LinkedIn ↗</a>
            )}
            <span className="text-faint">Added {formatDate(candidate.createdAt)}{candidate.source === "csv" ? " via CSV" : ""}</span>
          </>
        }
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

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        {/* Main column: role-specific review */}
        <div className="min-w-0 space-y-5">
          <div className="flex flex-wrap items-center gap-1.5">
            {candidate.applications.map((a) => (
              <Link
                key={a.id}
                href={`/candidates/${candidate.id}?role=${a.roleId}`}
                className={clsx(
                  "inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium",
                  a.id === app?.id ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken",
                )}
              >
                {a.role.title}
                <span className={clsx("text-[11.5px] font-normal", a.id === app?.id ? "text-white/70" : "text-muted")}>{STAGE_LABEL[a.stage as Stage]}</span>
              </Link>
            ))}
            <AddToRole candidateId={candidate.id} roles={availableRoles} />
          </div>

          {!app ? (
            <EmptyState title="Not in any role yet" body="Add this candidate to a role to move them through its pipeline and assess them against its criteria." />
          ) : (
            <>
              <Card className="flex flex-wrap items-center gap-x-5 gap-y-3 px-5 py-4">
                <div className="min-w-0 flex-1">
                  <Link href={`/roles/${app.roleId}`} className="font-semibold tracking-tight hover:underline">{app.role.title}</Link>
                  <div className="text-[12.5px] text-muted">
                    In pipeline since {formatDate(app.createdAt)}
                    {app.decision && <> · Decision: <span className="font-medium text-ink-2">{DECISION_LABEL[app.decision as Decision]}</span>{app.decidedByName ? ` by ${app.decidedByName}` : ""}</>}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-[12.5px] text-muted">
                  Stage <StageSelect applicationId={app.id} stage={app.stage} />
                </label>
                <ActionButton action={removeFromRole.bind(null, app.id)} variant="ghost" confirm={`Remove ${candidate.fullName} from ${app.role.title}? Their assessments for this role are deleted.`}>
                  Remove from role
                </ActionButton>
              </Card>

              <section>
                <SectionTitle
                  hint="Each approved criterion is checked against the resume and candidate-provided information. You review, correct and decide."
                  action={<RunAssessment applicationId={app.id} aiConfigured={ai.configured} hasAssessment={!!latest} disabledReason={disabledReason} />}
                >
                  Assessment
                </SectionTitle>

                {!latest ? (
                  <EmptyState title="Not assessed yet" body="Run an assessment to see, for each criterion, the supporting evidence, what's missing, and what is only inferred." />
                ) : (
                  <div className="space-y-3">
                    {isStale(latest.criteriaSnapshot, app.role.criteria) && <StaleNotice />}
                    <Card className="overflow-hidden">
                      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-line bg-[#fbfaf8] px-4 py-3">
                        <GeneratorTag generator={latest.generator} model={latest.model} />
                        <span className="text-[12px] text-muted">
                          {formatDateTime(latest.createdAt)} · {latest.resume ? latest.resume.fileName : "no resume"}
                        </span>
                        <span className="ml-auto">
                          <ReviewControls assessmentId={latest.id} reviewed={latest.status === "reviewed"} reviewedBy={latest.reviewedByName} />
                        </span>
                      </div>
                      <div className="border-b border-line px-4 py-3">
                        <SummaryLine summary={summarize(latest.items)} />
                        <p className="mt-1 text-[12px] text-faint">
                          Summary = count of criteria per result, with your corrections applied. It is not a score; read the evidence below.
                          {latest.generator === "keyword" && " Keyword matches are marked “inferred” because a keyword alone doesn't confirm a criterion."}
                        </p>
                      </div>
                      <div className="divide-y divide-line">
                        {items.map((i) => <ItemCard key={i.id} item={i} />)}
                      </div>
                    </Card>
                    {earlier.length > 0 && (
                      <details className="text-[13px]">
                        <summary className="cursor-pointer text-muted hover:text-ink">{earlier.length} earlier assessment{earlier.length > 1 ? "s" : ""}</summary>
                        <Card className="mt-2 divide-y divide-line">
                          {earlier.map((a) => (
                            <div key={a.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5">
                              <GeneratorTag generator={a.generator} model={a.model} />
                              <span className="text-[12px] text-muted">{formatDateTime(a.createdAt)}</span>
                              <SummaryLine summary={summarize(a.items)} compact />
                              <span className="ml-auto">
                                <ActionButton action={deleteAssessment.bind(null, a.id)} variant="ghost" confirm="Delete this earlier assessment?">Delete</ActionButton>
                              </span>
                            </div>
                          ))}
                        </Card>
                      </details>
                    )}
                  </div>
                )}
              </section>

              <section>
                <SectionTitle hint="Your decision is recorded separately from the pipeline stage and from any AI output.">Recruiter decision</SectionTitle>
                <Card className="p-4">
                  <DecisionForm applicationId={app.id} decision={app.decision} note={app.decisionNote} />
                  {app.decidedAt && (
                    <p className="mt-2 text-[12px] text-faint">Last recorded {formatDateTime(app.decidedAt)}{app.decidedByName ? ` by ${app.decidedByName}` : ""}</p>
                  )}
                </Card>
              </section>

              <section>
                <SectionTitle>Stage history</SectionTitle>
                <ol className="space-y-1.5 border-l border-line pl-4 text-[13px]">
                  {app.stageEvents.map((e) => (
                    <li key={e.id} className="relative">
                      <span className="absolute -left-[19.5px] top-1.5 h-1.5 w-1.5 rounded-full bg-line-strong" />
                      {e.fromStage ? (
                        <>
                          {STAGE_LABEL[e.fromStage as Stage]} → <span className="font-medium">{STAGE_LABEL[e.toStage as Stage]}</span>
                        </>
                      ) : (
                        <>Added as <span className="font-medium">{STAGE_LABEL[e.toStage as Stage]}</span></>
                      )}
                      <span className="text-faint"> · {e.actorName || "Unknown"} · {formatDateTime(e.createdAt)}</span>
                    </li>
                  ))}
                </ol>
              </section>
            </>
          )}
        </div>

        {/* Side column: source material and notes */}
        <aside className="space-y-5">
          <Card className="p-4" id="resume">
            <SectionTitle
              action={
                resume && (
                  <span className="flex items-center gap-1">
                    {resume.storageKey && (
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
              Resume
            </SectionTitle>
            {resume ? (
              <div className="max-h-[520px] space-y-3 overflow-y-auto rounded-lg bg-[#fbfaf7] p-3">
                {pages.map((p, i) => (
                  <div key={i} id={`resume-p${i + 1}`}>
                    {pages.length > 1 && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Page {i + 1}</div>}
                    <div className="resume-text text-ink-2">{highlight(p, resumeQuotes)}</div>
                  </div>
                ))}
                {pages.join("").trim() === "" && <p className="text-[13px] text-faint">No text could be extracted.</p>}
              </div>
            ) : (
              <p className="mb-3 text-[13px] text-muted">No resume yet.</p>
            )}
            <div className="mt-3">
              <ResumeUpload candidateId={candidate.id} hasResume={!!resume} />
            </div>
            {candidate.resumes.length > 1 && <p className="mt-2 text-[12px] text-faint">{candidate.resumes.length - 1} earlier version(s) kept.</p>}
          </Card>

          <Card className="p-4" id="candidate-info">
            <SectionTitle hint="Provided by the candidate; can be cited as evidence.">Candidate-provided info</SectionTitle>
            {candidate.candidateSummary ? (
              <div className="whitespace-pre-wrap text-[13px] text-ink-2">{highlight(candidate.candidateSummary, profileQuotes)}</div>
            ) : (
              <p className="text-[13px] text-faint">None. Add it via Edit profile.</p>
            )}
          </Card>

          <Card className="p-4">
            <SectionTitle hint="Internal only. Never used as assessment evidence.">Notes</SectionTitle>
            <NoteForm candidateId={candidate.id} roles={candidate.applications.map((a) => ({ id: a.roleId, title: a.role.title }))} />
            {candidate.notes.length > 0 && (
              <ul className="mt-2 divide-y divide-line">
                {candidate.notes.map((n) => (
                  <NoteItem
                    key={n.id}
                    note={{ id: n.id, body: n.body, authorName: n.authorName, createdAt: n.createdAt.toISOString(), roleTitle: n.roleId ? roleTitles.get(n.roleId) ?? null : null }}
                  />
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </>
  );
}
