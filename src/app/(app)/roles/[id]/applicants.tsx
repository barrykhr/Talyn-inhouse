import clsx from "clsx";
import Link from "next/link";
import { EvidenceCounts, ModeBanner, OriginBadge, SampleBadge } from "@/components/role-workspace";
import { ReviewActions } from "@/components/review-actions";
import { StageSelect } from "@/components/stage-select";
import { SummaryLine } from "@/components/summary";
import { AiMark, Badge, Card, EmptyState, LinkButton, buttonClass, formatDate } from "@/components/ui";
import { GENERATOR_LABEL, RECOMMENDATION_LABEL, STAGES, STAGE_LABEL, type Recommendation, type Stage } from "@/lib/domain";
import { compareFit, roleFit, stageReadiness } from "@/lib/ranking";
import { REVIEW_STATUSES, REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE, evidenceCounts, reviewStatus } from "@/lib/review-status";
import { computeScore, pct, type Weights } from "@/lib/score";
import { passesSkillFilter, type SkillMatch } from "@/lib/skills";
import { SkillCount, SkillFilterFields } from "@/components/skill-match";
import { isStale, summarize } from "@/lib/summary";
import { AddExisting } from "./add-existing";
import { PrioritySelect } from "./priority";

type Criteria = Parameters<typeof roleFit>[1]["criteria"];
type ItemLite = { criterionName: string; criterionId: string | null; kind: string; importance: string; result: string; overrideResult: string | null };
export type AppRow = {
  id: string;
  candidateId: string;
  stage: string;
  decision: string | null;
  decisionReason: string | null;
  decidedByName: string | null;
  decidedAt: Date | null;
  priority: number;
  priorityByName: string | null;
  origin: string;
  originDetail: string | null;
  createdAt: Date;
  sourcedProfileId: string | null;
  candidate: {
    id: string;
    fullName: string;
    currentTitle: string | null;
    currentCompany: string | null;
    candidateSummary: string | null;
    extractionStatus: string | null;
    isSample: boolean;
    resumes: { id: string }[];
    _count: { resumes: number };
  };
  stageEvents: { createdAt: Date }[];
  assessments: { id: string; status: string; generator: string; criteriaSnapshot: string; resumeId: string | null; profileHash: string | null; finalRecommendation: string | null; recommendation: string | null; recommendationStatus: string | null; createdAt: Date; criteriaVersion: number | null; items: ItemLite[] }[];
  _count: { tasks: number };
};

export type ApplicantFilters = { q: string; stage: string; review: string; view: "list" | "board" | "ranked"; sort: string; skills: string; minskills: string };

/** Inbound workflow: people who applied to this role. Discovered people never appear here. */
export function ApplicantsTab({
  roleId,
  applicants,
  matchingIds,
  filters,
  approved,
  criteriaVersion,
  others,
  skillMatches,
  requiredSkills,
  weights,
}: {
  roleId: string;
  skillMatches: Map<string, SkillMatch>;
  requiredSkills: number;
  weights: Weights;
  applicants: AppRow[];
  matchingIds: Set<string> | null; // candidate ids matching the text search, or null when there's no search
  filters: ApplicantFilters;
  approved: Criteria;
  criteriaVersion: number;
  others: { id: string; fullName: string; currentTitle: string | null }[];
}) {
  const { q, stage, review, view, sort, skills, minskills } = filters;
  const skillFiltered = applicants.filter((a) => passesSkillFilter(skillMatches.get(a.id), filters));
  const rows = skillFiltered
    .map((a) => ({ a, status: reviewStatus(a), latest: a.assessments[0] ?? null }))
    .filter(({ a, status }) => (!matchingIds || matchingIds.has(a.candidateId)) && (!stage || a.stage === stage) && (!review || status === review))
    .sort((x, y) =>
      sort === "skills"
        ? (skillMatches.get(y.a.id)?.evidenced ?? -1) - (skillMatches.get(x.a.id)?.evidenced ?? -1) || y.a.createdAt.getTime() - x.a.createdAt.getTime()
        : sort === "name" ? x.a.candidate.fullName.localeCompare(y.a.candidate.fullName) : sort === "oldest" ? x.a.createdAt.getTime() - y.a.createdAt.getTime() : y.a.createdAt.getTime() - x.a.createdAt.getTime(),
    );
  const filtered = !!(q || stage || review || skills || minskills);
  const base = `/roles/${roleId}?tab=applicants`;

  return (
    <div className="space-y-4">
      <ModeBanner mode="applicants">
        People who applied to this role. Review their evidence and decide — Shortlist, Hold or Reject are always your call, and never move the pipeline stage.
      </ModeBanner>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5 text-[13px]" role="group" aria-label="Applicants view">
          {(["list", "board", "ranked"] as const).map((v) => (
            <Link
              key={v}
              href={`${base}${v === "list" ? "" : `&view=${v}`}`}
              aria-current={view === v ? "page" : undefined}
              className={clsx("rounded-md px-3 py-1 font-medium", view === v ? "bg-ink text-white" : "text-muted hover:text-ink")}
            >
              {v === "list" ? "List" : v === "board" ? "Board" : "Ranked"}
            </Link>
          ))}
        </div>
        <div className="flex flex-wrap gap-2">
          <AddExisting roleId={roleId} candidates={others} />
          <LinkButton href={`/import?role=${roleId}`}>Import CSV</LinkButton>
          <LinkButton href={`/candidates/new?role=${roleId}`} variant="primary">
            Add applicant
          </LinkButton>
        </div>
      </div>

      {approved.length === 0 && (
        <p className="text-[13px] text-warn">
          No active criteria yet — <Link className="underline" href={`/roles/${roleId}?tab=criteria`}>set them up</Link> before assessing applicants.
        </p>
      )}

      {applicants.length === 0 ? (
        <EmptyState
          title="No applicants yet"
          body="Add an applicant with their CV, pick an existing candidate, or import a CSV. People you find yourself go in Discover, not here."
          action={
            <>
              <LinkButton href={`/candidates/new?role=${roleId}`} variant="primary">
                Add applicant
              </LinkButton>
              <LinkButton href={`/roles/${roleId}/discover`}>Go to Discover</LinkButton>
            </>
          }
        />
      ) : view === "board" ? (
        <Board roleId={roleId} applicants={skillFiltered} approved={approved} skillMatches={skillMatches} weights={weights} />
      ) : view === "ranked" ? (
        <Ranked roleId={roleId} applicants={skillFiltered} approved={approved} criteriaVersion={criteriaVersion} sort={sort} stageFilter={stage} skillMatches={skillMatches} weights={weights} />
      ) : (
        <>
          <form role="search" aria-label="Filter applicants" className="flex flex-wrap items-end gap-2 rounded-xl border border-line bg-surface p-3 text-[13px]">
            <input type="hidden" name="tab" value="applicants" />
            <label className="flex min-w-56 flex-1 flex-col gap-1">
              <span className="font-medium text-ink-2">Search</span>
              <input
                name="q"
                defaultValue={q}
                type="search"
                placeholder="Name, title, company or skill (searches the CV)"
                className="h-9 rounded-lg border border-line-strong bg-surface px-3 text-[13px] placeholder:text-faint focus:border-ink focus:outline-none"
              />
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-ink-2">Stage</span>
              <select name="stage" defaultValue={stage} className="h-9 rounded-lg border border-line-strong bg-surface px-2">
                <option value="">All stages</option>
                {STAGES.map((s) => (
                  <option key={s} value={s}>
                    {STAGE_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <label className="flex flex-col gap-1">
              <span className="font-medium text-ink-2">Review status</span>
              <select name="review" defaultValue={review} className="h-9 rounded-lg border border-line-strong bg-surface px-2">
                <option value="">All</option>
                {REVIEW_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {REVIEW_STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
            <SkillFilterFields skills={skills} minskills={minskills} required={requiredSkills} />
            <label className="flex flex-col gap-1">
              <span className="font-medium text-ink-2">Sort</span>
              <select name="sort" defaultValue={sort} className="h-9 rounded-lg border border-line-strong bg-surface px-2">
                <option value="recent">Newest applications</option>
                <option value="oldest">Oldest applications</option>
                <option value="name">Name</option>
                {requiredSkills > 0 && <option value="skills">Most required skills evidenced</option>}
              </select>
            </label>
            <button className={buttonClass("secondary", "md")}>Apply</button>
            {filtered && (
              <Link href={base} className="h-9 px-2 leading-9 text-muted hover:text-ink">
                Clear
              </Link>
            )}
          </form>

          <p className="text-[12.5px] text-muted" aria-live="polite">
            {rows.length} of {applicants.length} applicant{applicants.length === 1 ? "" : "s"}
            {filtered ? " match" : ""} · Required skills (e.g. 5/6) count only skills with evidence found in the candidate&apos;s own material. Criteria counts are separate. Neither is a score or a decision.
          </p>

          {rows.length === 0 ? (
            <EmptyState title="No applicants match these filters" body="Try a different name or skill, or clear the filters." action={<LinkButton href={base}>Clear filters</LinkButton>} />
          ) : (
            <Card className="overflow-hidden">
              <div className="hidden grid-cols-[minmax(0,1.4fr)_100px_150px_150px_minmax(0,1fr)_auto] gap-4 border-b border-line bg-[#fbfaf8] px-4 py-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint lg:grid">
                <span>Applicant</span>
                <span>Applied</span>
                <span>Stage</span>
                <span>Required skills</span>
                <span>Review · criteria evidence</span>
                <span className="text-right">Your decision</span>
              </div>
              <ul className="divide-y divide-line">
                {rows.map(({ a, status, latest }) => {
                  const stale = latest ? isStale(latest.criteriaSnapshot, approved) : false;
                  return (
                    <li key={a.id} className="grid gap-x-4 gap-y-2 px-4 py-3 lg:grid-cols-[minmax(0,1.4fr)_100px_150px_150px_minmax(0,1fr)_auto] lg:items-center">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <Link href={`/candidates/${a.candidate.id}?role=${roleId}`} className="font-medium hover:underline">
                            {a.candidate.fullName}
                          </Link>
                          <OriginBadge origin={a.origin} detail={a.originDetail} />
                          {a.candidate.isSample && <SampleBadge />}
                        </div>
                        <div className="truncate text-[12.5px] text-muted">
                          {[a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(" · ") || <span className="text-faint">No current role on record</span>}
                        </div>
                      </div>
                      <div className="text-[12.5px] text-ink-2">
                        <span className="text-faint lg:hidden">Applied </span>
                        <time dateTime={a.createdAt.toISOString()} title="Date the application was added to Talyn">
                          {formatDate(a.createdAt)}
                        </time>
                      </div>
                      <StageSelect applicationId={a.id} stage={a.stage} />
                      <Link href={`/candidates/${a.candidate.id}?role=${roleId}#skills`} className="rounded-md hover:bg-sunken/60" aria-label={`Skill evidence for ${a.candidate.fullName}`}>
                        {skillMatches.get(a.id) && <SkillCount m={skillMatches.get(a.id)!} stacked />}
                      </Link>
                      <div className="min-w-0 space-y-0.5">
                        <Badge tone={REVIEW_STATUS_TONE[status]}>{REVIEW_STATUS_LABEL[status]}</Badge>
                        <div>
                          <EvidenceCounts counts={latest ? evidenceCounts(latest.items) : null} />
                          {stale && <span className="ml-2 text-[12px] text-warn">· assessment out of date</span>}
                        </div>
                      </div>
                      <div className="lg:justify-self-end">
                        <ReviewActions applicationId={a.id} decision={a.decision} name={a.candidate.fullName} compact />
                      </div>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}
        </>
      )}
    </div>
  );
}

function Board({
  roleId,
  applicants,
  approved,
  skillMatches,
  weights,
}: {
  roleId: string;
  applicants: AppRow[];
  approved: { id: string; updatedAt: Date }[];
  skillMatches: Map<string, SkillMatch>;
  weights: Weights;
}) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 pb-2 md:mx-0 md:px-0">
      <div className="flex min-w-max gap-3">
        {STAGES.map((stage) => {
          const apps = applicants.filter((a) => a.stage === stage);
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
                  const status = reviewStatus(a);
                  return (
                    <Card key={a.id} className="p-3">
                      <Link href={`/candidates/${a.candidate.id}?role=${roleId}`} className="block font-medium leading-snug hover:underline">
                        {a.candidate.fullName}
                      </Link>
                      {(a.candidate.currentTitle || a.candidate.currentCompany) && (
                        <div className="truncate text-[12.5px] text-muted">{[a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(" · ")}</div>
                      )}
                      <div className="mt-2 space-y-1">
                        {skillMatches.get(a.id) && <SkillCount m={skillMatches.get(a.id)!} className="text-[12px]" />}
                        {asmt ? (
                          <>
                            <ScoreChip items={asmt.items} weights={weights} />
                            <SummaryLine summary={summarize(asmt.items)} compact />
                            {(asmt.finalRecommendation ?? asmt.recommendation) && (
                              <div className="flex items-center gap-1 text-[11.5px] text-ink-2">
                                {asmt.finalRecommendation ? <span className="font-medium text-muted">Reviewed:</span> : <AiMark label="AI suggests" />}
                                <span className="truncate">{RECOMMENDATION_LABEL[(asmt.finalRecommendation ?? asmt.recommendation) as Recommendation]}</span>
                              </div>
                            )}
                            <div className="flex flex-wrap gap-1">
                              {asmt.generator !== "ai" && <Badge>{GENERATOR_LABEL[asmt.generator]}</Badge>}
                              {stale && (
                                <Badge tone="warn" title="Criteria changed after this assessment">
                                  Outdated
                                </Badge>
                              )}
                            </div>
                          </>
                        ) : (
                          <span className="text-[12.5px] text-faint">Not assessed</span>
                        )}
                        <Badge tone={REVIEW_STATUS_TONE[status]}>{REVIEW_STATUS_LABEL[status]}</Badge>
                      </div>
                      <div className="mt-2.5 flex items-center gap-2">
                        <StageSelect applicationId={a.id} stage={a.stage} className="min-w-0 flex-1" />
                        <span className="shrink-0 text-[11.5px] tabular-nums text-faint" title="Time in this stage">
                          {timeInStage(a.stageEvents[0]?.createdAt ?? a.createdAt)}
                        </span>
                      </div>
                    </Card>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Ranked({
  roleId,
  applicants,
  approved,
  criteriaVersion,
  sort,
  stageFilter,
  skillMatches,
  weights,
}: {
  roleId: string;
  applicants: AppRow[];
  approved: Criteria;
  criteriaVersion: number;
  sort: string;
  stageFilter: string;
  skillMatches: Map<string, SkillMatch>;
  weights: Weights;
}) {
  // Ranking (see src/lib/ranking.ts): role fit across the role; readiness only within a stage.
  const ranked = applicants.map((a) => {
    const fit = roleFit(a.assessments, { criteria: approved, criteriaVersion, weights });
    const latestA = a.assessments[0] ?? null;
    const readiness = stageReadiness({
      stage: a.stage,
      hasCv: a.candidate._count.resumes > 0,
      profileReviewed: a.candidate.extractionStatus !== "needs_review",
      assessment: latestA,
      assessmentCurrent: fit.state !== "unranked" || (!!latestA && !fit.reason.startsWith("Criteria changed")),
      openRequests: a._count.tasks,
      decision: a.decision,
    });
    return { a, fit, readiness, since: a.stageEvents[0]?.createdAt ?? a.createdAt };
  });
  const fitOrder = ranked.filter((r) => r.fit.state === "ranked" && r.a.stage !== "rejected").sort((x, y) => compareFit(x.fit, y.fit));
  const fitRank = new Map(fitOrder.map((r, i) => [r.a.id, i + 1]));
  const readinessRank = new Map<string, string>();
  for (const st of STAGES) {
    const inStage = ranked.filter((r) => r.a.stage === st && r.readiness).sort((x, y) => y.readiness!.met / y.readiness!.total - x.readiness!.met / x.readiness!.total);
    inStage.forEach((r, i) => readinessRank.set(r.a.id, `${i + 1} of ${inStage.length} in ${STAGE_LABEL[st]}`));
  }
  const s = ["fit", "readiness", "priority", "time", "name"].includes(sort) ? sort : "fit";
  const listRows = ranked
    .filter((r) => !stageFilter || r.a.stage === stageFilter)
    .sort((x, y) =>
      s === "readiness"
        ? (y.readiness ? y.readiness.met / y.readiness.total : -1) - (x.readiness ? x.readiness.met / x.readiness.total : -1)
        : s === "time"
          ? x.since.getTime() - y.since.getTime()
          : s === "name"
            ? x.a.candidate.fullName.localeCompare(y.a.candidate.fullName)
            : s === "priority"
              ? y.a.priority - x.a.priority || compareFit(x.fit, y.fit)
              : compareFit(x.fit, y.fit),
    );
  return (
    <>
      <form className="flex flex-wrap items-center gap-2 text-[13px]">
        <input type="hidden" name="tab" value="applicants" />
        <input type="hidden" name="view" value="ranked" />
        <label className="flex items-center gap-1.5 text-muted">
          Sort
          <select name="sort" defaultValue={s} className="h-8 rounded-md border border-line-strong bg-surface px-1.5 text-[13px] text-ink">
            <option value="fit">Role fit</option>
            <option value="readiness">Stage readiness</option>
            <option value="priority">Recruiter priority</option>
            <option value="time">Longest in stage</option>
            <option value="name">Name</option>
          </select>
        </label>
        <label className="flex items-center gap-1.5 text-muted">
          Stage
          <select name="stage" defaultValue={stageFilter} className="h-8 rounded-md border border-line-strong bg-surface px-1.5 text-[13px] text-ink">
            <option value="">All</option>
            {STAGES.map((st) => (
              <option key={st} value={st}>
                {STAGE_LABEL[st]}
              </option>
            ))}
          </select>
        </label>
        <button className={buttonClass("secondary", "sm")}>Apply</button>
      </form>
      <Card className="overflow-hidden">
        <div className="border-b border-line bg-[#fbfaf8] px-4 py-2 text-[12px] text-muted">
          <strong className="font-medium text-ink-2">Role fit</strong> = evaluation-criteria alignment of the latest assessment: how much of the approved criteria the evidence supports, weighted
          required {weights.essential} : preferred {weights.preferred}. The required-skill count is shown separately and is not part of it. It is not a measure of candidate quality or likelihood of success, and it is unranked when evidence is insufficient or criteria changed. Open a candidate for
          the per-criterion evidence. <strong className="font-medium text-ink-2">Readiness</strong> = checklist for the next decision, compared only within the same stage. Neither moves or decides
          anything.
        </div>
        <div className="divide-y divide-line">
          {listRows.map(({ a, fit, readiness, since }) => (
            <div key={a.id} className="grid gap-x-4 gap-y-1.5 px-4 py-3 md:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <Link href={`/candidates/${a.candidate.id}?role=${roleId}`} className="font-medium hover:underline">
                  {a.candidate.fullName}
                </Link>
                <div className="truncate text-[12.5px] text-muted">
                  {STAGE_LABEL[a.stage as Stage]} · {timeInStage(since)} in stage · {REVIEW_STATUS_LABEL[reviewStatus(a)]}
                </div>
                {a.priority !== 0 && (
                  <div className="text-[11.5px] text-ink-2">
                    Priority {a.priority > 0 ? "high" : "low"}
                    {a.priorityByName ? ` · set by ${a.priorityByName}` : ""}
                  </div>
                )}
              </div>
              <div className="text-[12.5px]">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Role fit</div>
                {fit.state === "unranked" ? (
                  <div className="text-muted">Unranked · {fit.reason}</div>
                ) : (
                  <div>
                    <span className="font-semibold tabular-nums">{fit.score}</span>
                    <span className="text-faint">/100</span>
                    {fit.state === "ranked" ? <span className="text-muted"> · #{fitRank.get(a.id)} of {fitOrder.length} ranked</span> : <span className="text-warn"> · low confidence</span>}
                    <div className="text-[11.5px] text-muted">
                      {fit.reason} · updated {fit.updatedAt?.toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {fit.criteriaVersion ? ` · criteria v${fit.criteriaVersion}` : ""}
                    </div>
                  </div>
                )}
                {a.assessments[0] && <EvidenceCounts counts={evidenceCounts(a.assessments[0].items)} className="mt-0.5" />}
                {skillMatches.get(a.id) && <SkillCount m={skillMatches.get(a.id)!} className="mt-1" />}
                {fit.change && <div className="text-[11.5px] text-ink-2">Changed: {fit.change}</div>}
              </div>
              <div className="text-[12.5px]">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-faint">Readiness</div>
                {readiness ? (
                  <details>
                    <summary className="cursor-pointer">
                      <span className="font-semibold tabular-nums">{readiness.met}</span>
                      <span className="text-faint">/{readiness.total}</span>{" "}
                      <span className="text-muted">
                        for {readiness.nextDecision} · {readinessRank.get(a.id)}
                      </span>
                    </summary>
                    <ul className="mt-1 space-y-0.5 text-[11.5px]">
                      {readiness.checks.map((c) => (
                        <li key={c.label} className={c.met ? "text-ok" : "text-muted"}>
                          {c.met ? "✓" : "○"} {c.label}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : (
                  <div className="text-muted">Closed stage</div>
                )}
              </div>
              <div className="flex items-start gap-2">
                <PrioritySelect applicationId={a.id} priority={a.priority} />
                <StageSelect applicationId={a.id} stage={a.stage} />
              </div>
            </div>
          ))}
        </div>
      </Card>
    </>
  );
}

/** Calm, factual time in stage ("3d"). Informational only — never styled as urgent. */
export function timeInStage(since: Date) {
  const mins = Math.max(0, Math.floor((Date.now() - new Date(since).getTime()) / 60000));
  if (mins < 60) return "<1h";
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  const days = Math.floor(hours / 24);
  return days < 60 ? `${days}d` : `${Math.floor(days / 30)}mo`;
}

function ScoreChip({ items, weights }: { items: ItemLite[]; weights: Weights }) {
  const s = computeScore(items.map((i) => ({ name: i.criterionName, importance: i.importance, result: i.result, overrideResult: i.overrideResult, kind: i.kind })), weights);
  return (
    <div className="text-[12px]" title="Criteria-alignment score (alignment-v1) and weighted evidence coverage. Not a measure of candidate quality. Open the candidate for per-criterion evidence.">
      {s.score === null ? (
        <span className="text-muted">Score withheld · coverage {pct(s.coverage)}</span>
      ) : (
        <span>
          <span className="font-semibold tabular-nums">{s.score}</span>
          <span className="text-faint">/100 criteria alignment</span>
          <span className="text-muted"> · coverage {pct(s.coverage)}</span>
        </span>
      )}
    </div>
  );
}
