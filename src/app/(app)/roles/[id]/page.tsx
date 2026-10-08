import clsx from "clsx";
import Link from "next/link";
import { ActionButton } from "@/components/client";
import { StageSelect } from "@/components/stage-select";
import { RoleStatusBadge } from "@/components/status";
import { SourceRef } from "@/components/source-ref";
import { SummaryLine } from "@/components/summary";
import { AiMark, Badge, Card, EmptyState, LinkButton, Notice, PageHeader, SectionTitle, buttonClass, formatDate } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECISION_LABEL, EMPLOYMENT_TYPE_LABEL, GENERATOR_LABEL, RECOMMENDATION_LABEL, STAGES, STAGE_LABEL, type Decision, type EmploymentType, type Recommendation } from "@/lib/domain";
import { computeScore, pct } from "@/lib/score";
import { isStale, summarize } from "@/lib/summary";
import { deleteRole } from "@/server/role-actions";
import { ownRole } from "@/server/scope";
import { AddExisting } from "./add-existing";
import { LIST_LABEL } from "@/lib/extraction-fields";
import { RoleReviewForm, UploadJd, type FactView } from "./jd";
import { AddCriterion, CriterionRow, ProposePanel, ReviewBanner, type CriterionView } from "./criteria";

// AI proposals/assessments run as server actions on this page and can take a while.
export const maxDuration = 300;

export const metadata = { title: "Role" };

type Tab = "pipeline" | "criteria" | "description";

export default async function RolePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; notice?: string; saved?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const { tab: tabParam, notice, saved } = await searchParams;
  await ownRole(auth, id);

  const role = await db.role.findFirstOrThrow({
    where: { id, orgId: auth.orgId },
    include: {
      criteria: { orderBy: [{ priority: "asc" }, { position: "asc" }] },
      applications: {
        include: {
          candidate: { select: { id: true, fullName: true, currentTitle: true, currentCompany: true } },
          assessments: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: { items: { select: { criterionName: true, importance: true, result: true, overrideResult: true } } },
          },
        },
        orderBy: { updatedAt: "desc" },
      },
      documents: { orderBy: { createdAt: "desc" }, select: { id: true, fileName: true, createdAt: true, isCurrent: true, parserVersion: true } },
      extracted: { where: { status: { not: "rejected" } }, orderBy: { position: "asc" } },
    },
  });

  const approved = role.criteria.filter((c) => c.status === "approved");
  const proposed = role.criteria.filter((c) => c.status === "proposed");
  const rejected = role.criteria.filter((c) => c.status === "rejected");
  const needsReview = role.extractionStatus === "needs_review";
  const tab: Tab =
    tabParam === "criteria" || tabParam === "description" || tabParam === "pipeline"
      ? tabParam
      : needsReview
        ? "description"
        : approved.length === 0
          ? "criteria"
          : "pipeline";
  const facts: FactView[] = role.extracted.map((f) => ({
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
  }));
  const pendingFacts = facts.filter((f) => f.status === "pending");
  const reviewedFacts = facts.filter((f) => f.status !== "pending" && f.field in LIST_LABEL);

  const inRole = new Set(role.applications.map((a) => a.candidateId));
  const others = tab === "pipeline"
    ? (await db.candidate.findMany({ where: { orgId: auth.orgId }, select: { id: true, fullName: true, currentTitle: true }, orderBy: { fullName: "asc" }, take: 500 })).filter((c) => !inRole.has(c.id))
    : [];

  const toView = (c: (typeof role.criteria)[number]): CriterionView => ({ ...c, approvedAt: c.approvedAt?.toISOString() ?? null });
  const ai = aiStatus();

  return (
    <>
      <PageHeader
        eyebrow={<Link href="/roles" className="hover:text-ink">Roles</Link>}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {role.title} <RoleStatusBadge status={role.status} />
          </span>
        }
        meta={
          <>
            {role.department && <span>{role.department}</span>}
            {role.location && <span>{role.location}</span>}
            <span>{EMPLOYMENT_TYPE_LABEL[role.employmentType as EmploymentType]}</span>
            <span>Updated {formatDate(role.updatedAt)}</span>
          </>
        }
        actions={
          <>
            <a href={`/api/export/roles/${role.id}`} className={buttonClass("ghost")}>Export CSV</a>
            <LinkButton href={`/roles/${role.id}/edit`}>Edit role</LinkButton>
            <ActionButton
              size="md"
              variant="danger"
              action={deleteRole.bind(null, role.id)}
              confirm={`Delete “${role.title}”? Its criteria, pipeline and assessments are removed. Candidate profiles are kept.`}
            >
              Delete
            </ActionButton>
          </>
        }
      />

      {notice && <Notice tone="warn" className="mb-4">{notice}</Notice>}
      {saved === "details" && (
        <Notice tone="ok" className="mb-4">
          Role details saved from your review.{proposed.length > 0 ? " Next, review the criteria proposed from the JD below." : ""}
        </Notice>
      )}
      {needsReview && tab !== "description" && (
        <Notice tone="signal" className="mb-4">
          Details extracted from the uploaded job description are waiting for your review.{" "}
          <Link href={`/roles/${role.id}?tab=description`} className="font-medium underline">Review now</Link>
        </Notice>
      )}

      <div className="mb-5 flex gap-1 border-b border-line">
        <TabLink href={`/roles/${role.id}?tab=pipeline`} active={tab === "pipeline"} label="Pipeline" count={role.applications.length} />
        <TabLink href={`/roles/${role.id}?tab=criteria`} active={tab === "criteria"} label="Criteria" count={approved.length} attention={proposed.length} />
        <TabLink href={`/roles/${role.id}?tab=description`} active={tab === "description"} label="Job description" attention={needsReview ? pendingFacts.length || 1 : 0} />
      </div>

      {tab === "criteria" && (
        <div className="space-y-5">
          {proposed.length > 0 && <ReviewBanner roleId={role.id} count={proposed.length} />}
          <ProposePanel roleId={role.id} aiConfigured={ai.configured} hasDescription={role.description.trim().length >= 40} hasCriteria={role.criteria.length > 0} />

          {proposed.length > 0 && (
            <section>
              <SectionTitle hint="Not used in assessments until approved.">Awaiting your review</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">{proposed.map((c) => <CriterionRow key={c.id} c={toView(c)} />)}</Card>
            </section>
          )}

          <section>
            <SectionTitle hint="These are used when assessing candidates for this role." action={<AddCriterion roleId={role.id} />}>
              Active criteria
            </SectionTitle>
            {approved.length === 0 ? (
              <EmptyState title="No active criteria" body="Add criteria manually, or draft them from the job description and approve the ones that fit." />
            ) : (
              <div className="space-y-4">
                {(["essential", "preferred"] as const).map((imp) => {
                  const list = approved.filter((c) => c.importance === imp);
                  if (!list.length) return null;
                  return (
                    <div key={imp}>
                      <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{imp === "essential" ? "Essential" : "Preferred"} · {list.length}</div>
                      <Card className="divide-y divide-line overflow-hidden">{list.map((c) => <CriterionRow key={c.id} c={toView(c)} />)}</Card>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          {rejected.length > 0 && (
            <details>
              <summary className="cursor-pointer text-[13px] text-muted hover:text-ink">{rejected.length} rejected</summary>
              <Card className="mt-2 divide-y divide-line overflow-hidden">{rejected.map((c) => <CriterionRow key={c.id} c={toView(c)} />)}</Card>
            </details>
          )}
        </div>
      )}

      {tab === "description" && (
        <div className="space-y-5">
          {needsReview && (
            <RoleReviewForm
              roleId={role.id}
              facts={pendingFacts}
              current={{ title: role.title, department: role.department, location: role.location, employmentType: role.employmentType }}
            />
          )}
          {needsReview && proposed.length > 0 && (
            <p className="text-[13px] text-muted">
              {proposed.length} criteria were also proposed from this JD — <Link className="font-medium text-ink underline" href={`/roles/${role.id}?tab=criteria`}>review them on the Criteria tab</Link>.
            </p>
          )}

          <Card className="p-5">
            <SectionTitle action={<UploadJd roleId={role.id} hasJd={role.documents.length > 0} />} hint="Kept privately with the role. Extraction re-runs on each upload.">
              Uploaded job description
            </SectionTitle>
            {role.documents.length === 0 ? (
              <p className="text-[13px] text-muted">No file uploaded. You can upload a PDF or DOCX to extract details and propose criteria.</p>
            ) : (
              <ul className="space-y-1 text-[13px]">
                {role.documents.map((d) => (
                  <li key={d.id} className="flex flex-wrap items-center gap-2">
                    <a href={`/api/jds/${d.id}`} target="_blank" rel="noopener" className="font-medium underline-offset-2 hover:underline">{d.fileName}</a>
                    <span className="text-faint">{formatDate(d.createdAt)} · {d.parserVersion}</span>
                    {d.isCurrent && <Badge>Current</Badge>}
                  </li>
                ))}
              </ul>
            )}
          </Card>

          {reviewedFacts.length > 0 && (
            <Card className="p-5">
              <SectionTitle hint="Extracted from the JD and reviewed by a recruiter.">Role details</SectionTitle>
              <div className="space-y-4">
                {Object.entries(LIST_LABEL).map(([group, label]) => {
                  const items = reviewedFacts.filter((f) => f.field === group);
                  if (!items.length) return null;
                  return (
                    <div key={group}>
                      <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</div>
                      <ul className="space-y-2">
                        {items.map((f) => (
                          <li key={f.id} className="text-[13.5px]">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <span>{String(f.status === "edited" ? f.editedValue : f.value)}</span>
                              {f.status === "edited" && <Badge tone="warn">Corrected by recruiter</Badge>}
                            </div>
                            <SourceRef doc="JD" quote={f.sourceQuote} page={f.sourcePage} section={f.sourceSection} verified={f.verified} extractor={f.extractor} />
                          </li>
                        ))}
                      </ul>
                    </div>
                  );
                })}
              </div>
            </Card>
          )}

          <Card className="p-6">
            <SectionTitle>Job description text</SectionTitle>
            {role.description ? (
              <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{role.description}</div>
            ) : (
              <EmptyState title="No job description" action={<LinkButton href={`/roles/${role.id}/edit`}>Add one</LinkButton>} />
            )}
          </Card>
        </div>
      )}

      {tab === "pipeline" && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[13px] text-muted">
              {approved.length === 0 ? (
                <span className="text-warn">No active criteria yet — <Link className="underline" href={`/roles/${role.id}?tab=criteria`}>set them up</Link> before assessing candidates.</span>
              ) : (
                <>Assessed against {approved.length} active criteria. Stage changes are always made by a recruiter.</>
              )}
            </div>
            <div className="flex flex-wrap gap-2">
              <AddExisting roleId={role.id} candidates={others} />
              <LinkButton href={`/candidates/new?role=${role.id}`} variant="primary">New candidate</LinkButton>
            </div>
          </div>

          {role.applications.length === 0 ? (
            <EmptyState
              title="No candidates in this pipeline"
              body="Add a candidate manually, pick an existing one, or import a CSV and attach it to this role."
              action={<LinkButton href={`/import?role=${role.id}`}>Import CSV</LinkButton>}
            />
          ) : (
            <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
              <div className="flex min-w-max gap-3">
                {STAGES.map((stage) => {
                  const apps = role.applications.filter((a) => a.stage === stage);
                  return (
                    <div key={stage} className={clsx("w-64 shrink-0", stage === "rejected" && "opacity-80")}>
                      <div className="mb-2 flex items-center justify-between px-1">
                        <span className="text-[12.5px] font-semibold text-ink-2">{STAGE_LABEL[stage]}</span>
                        <span className="text-[12px] tabular-nums text-faint">{apps.length}</span>
                      </div>
                      <div className="min-h-24 space-y-2 rounded-xl bg-sunken/60 p-1.5">
                        {apps.map((a) => {
                          const asmt = a.assessments[0];
                          const stale = asmt ? isStale(asmt.criteriaSnapshot, approved) : false;
                          return (
                            <Card key={a.id} className="p-3">
                              <Link href={`/candidates/${a.candidate.id}?role=${role.id}`} className="block font-medium leading-snug hover:underline">
                                {a.candidate.fullName}
                              </Link>
                              {(a.candidate.currentTitle || a.candidate.currentCompany) && (
                                <div className="truncate text-[12.5px] text-muted">{[a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(" · ")}</div>
                              )}
                              <div className="mt-2 space-y-1">
                                {asmt ? (
                                  <>
                                    <ScoreChip items={asmt.items} />
                                    <SummaryLine summary={summarize(asmt.items)} compact />
                                    {(asmt.finalRecommendation ?? asmt.recommendation) && (
                                      <div className="flex items-center gap-1 text-[11.5px] text-ink-2">
                                        {asmt.finalRecommendation ? <span className="font-medium text-muted">Reviewed:</span> : <AiMark label="AI suggests" />}
                                        <span className="truncate">{RECOMMENDATION_LABEL[(asmt.finalRecommendation ?? asmt.recommendation) as Recommendation]}</span>
                                      </div>
                                    )}
                                    <div className="flex flex-wrap gap-1">
                                      {asmt.status === "reviewed" ? <Badge tone="ok">Reviewed</Badge> : <Badge tone="signal">Needs review</Badge>}
                                      {asmt.generator !== "ai" && <Badge>{GENERATOR_LABEL[asmt.generator]}</Badge>}
                                      {stale && <Badge tone="warn" title="Criteria changed after this assessment">Outdated</Badge>}
                                    </div>
                                  </>
                                ) : (
                                  <span className="text-[12.5px] text-faint">Not assessed</span>
                                )}
                                {a.decision && (
                                  <div className="text-[12px] text-ink-2">
                                    Decision: <span className="font-medium">{DECISION_LABEL[a.decision as Decision]}</span>
                                  </div>
                                )}
                              </div>
                              <StageSelect applicationId={a.id} stage={a.stage} className="mt-2.5 w-full" />
                            </Card>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      )}
    </>
  );
}

function ScoreChip({ items }: { items: { criterionName: string; importance: string; result: string; overrideResult: string | null }[] }) {
  const s = computeScore(items.map((i) => ({ name: i.criterionName, importance: i.importance, result: i.result, overrideResult: i.overrideResult })));
  return (
    <div className="text-[12px]" title="Criteria-alignment score (alignment-v1) and weighted evidence coverage. Not a measure of candidate quality.">
      {s.score === null ? (
        <span className="text-muted">Score withheld · coverage {pct(s.coverage)}</span>
      ) : (
        <span>
          <span className="font-semibold tabular-nums">{s.score}</span>
          <span className="text-faint">/100 alignment</span>
          <span className="text-muted"> · coverage {pct(s.coverage)}</span>
        </span>
      )}
    </div>
  );
}

function TabLink({ href, active, label, count, attention }: { href: string; active: boolean; label: string; count?: number; attention?: number }) {
  return (
    <Link
      href={href}
      className={clsx(
        "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13.5px] font-medium",
        active ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
      )}
    >
      {label}
      {count !== undefined && <span className="text-[12px] tabular-nums text-faint">{count}</span>}
      {!!attention && <span className="rounded-full bg-signal px-1.5 text-[11px] font-semibold text-white">{attention}</span>}
    </Link>
  );
}
