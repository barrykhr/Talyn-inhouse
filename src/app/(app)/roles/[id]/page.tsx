import { getAtsConnector } from "@/lib/ats/connector";
import Link from "next/link";
import { ActionButton } from "@/components/client";
import { RoleStatusBadge } from "@/components/status";
import { SourceRef } from "@/components/source-ref";
import { StatusLine, type StatusItem } from "@/components/status-line";
import { Badge, Breadcrumbs, Card, EmptyState, LinkButton, Notice, PageHeader, SectionTitle, buttonClass, formatDate } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EMPLOYMENT_TYPE_LABEL, type EmploymentType } from "@/lib/domain";
import { isStale } from "@/lib/summary";
import { deleteRole } from "@/server/role-actions";
import { ownRole } from "@/server/scope";
import { QuestionList } from "@/components/questions";
import { generateCoreQuestions } from "@/server/question-actions";
import { ApplicantsTab } from "./applicants";
import { ShortlistTab } from "./shortlist";
import { RoleOverview } from "./overview";
import { RoleTabs } from "@/components/role-workspace";
import { THRESHOLD_FILTERS, matchForApplication, roleSkillConfig } from "@/lib/skills";
import { weightsOf } from "@/lib/score";
import { LIST_LABEL } from "@/lib/extraction-fields";
import { RoleReviewForm, UploadJd, type FactView } from "./jd";
import { AddCriterion, CriterionRow, ProposePanel, ReassessButton, ReviewBanner, RubricForm, type CriterionView } from "./criteria";
import { RecalculateButton, ScoringForm } from "./scoring";
import { parseBands } from "@/lib/profile-score";
import { IMPORTANCE_LABEL } from "@/lib/domain";

// AI proposals/assessments run as server actions on this page and can take a while.
export const maxDuration = 300;

export const metadata = { title: "Role" };

type Tab = "overview" | "applicants" | "shortlist" | "criteria" | "description";

export default async function RolePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string; notice?: string; saved?: string; view?: string; sort?: string; stage?: string; q?: string; review?: string; origin?: string; skills?: string; minskills?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const { tab: tabParam, notice, saved, view: viewParam, sort = "", stage: stageFilter = "", q = "", review = "", origin = "", skills: skillsParam = "", minskills: minParam = "" } = await searchParams;
  const skillFilter = {
    skills: (THRESHOLD_FILTERS as readonly string[]).includes(skillsParam) ? skillsParam : "",
    minskills: /^\d{1,2}$/.test(minParam) ? minParam : "",
  };
  const view = viewParam === "board" ? "board" : viewParam === "ranked" || viewParam === "list_ranked" ? "ranked" : "list";
  await ownRole(auth, id);

  const role = await db.role.findFirstOrThrow({
    where: { id, orgId: auth.orgId },
    include: {
      criteria: { orderBy: [{ priority: "asc" }, { position: "asc" }] },
      applications: {
        include: {
          candidate: {
            select: {
              id: true,
              fullName: true,
              currentTitle: true,
              currentCompany: true,
              candidateSummary: true,
              extractionStatus: true,
              isSample: true,
              resumes: { where: { isCurrent: true }, select: { id: true }, take: 1 },
              _count: { select: { resumes: true } },
            },
          },
          stageEvents: { orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
          assessments: {
            orderBy: { createdAt: "desc" },
            take: 2,
            include: { items: { select: { criterionName: true, criterionId: true, kind: true, importance: true, result: true, overrideResult: true } } },
          },
          _count: { select: { tasks: { where: { status: "open", type: "gather_info" } } } },
          profileScores: { orderBy: { createdAt: "desc" }, take: 1, include: { scoringVersion: { select: { version: true } } } },
        },
        orderBy: { updatedAt: "desc" },
      },
      documents: { orderBy: { createdAt: "desc" }, select: { id: true, fileName: true, createdAt: true, isCurrent: true, parserVersion: true } },
      extracted: { where: { status: { not: "rejected" } }, orderBy: { position: "asc" } },
      questions: { where: { kind: "core" }, orderBy: [{ status: "asc" }, { createdAt: "asc" }] },
    },
  });

  const approved = role.criteria.filter((c) => c.status === "approved");
  const proposed = role.criteria.filter((c) => c.status === "proposed");
  const rejected = role.criteria.filter((c) => c.status === "rejected");
  const needsReview = role.extractionStatus === "needs_review";
  const tab: Tab =
    tabParam === "overview" || tabParam === "criteria" || tabParam === "description" || tabParam === "applicants" || tabParam === "shortlist"
      ? tabParam
      : tabParam === "pipeline"
        ? "applicants"
        : needsReview
          ? "description"
          : "overview";
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

  // Where things stand for this role: what needs review and the next available action.
  const active = role.applications.filter((a) => a.stage !== "rejected" && a.stage !== "hired");
  const unassessed = active.filter((a) => a.assessments.length === 0).length;
  const outdated = active.filter((a) => a.assessments[0] && isStale(a.assessments[0].criteriaSnapshot, approved)).length;
  const awaitingDecision = active.filter((a) => a.assessments[0] && !a.decision).length;
  // Skill matching: one count per candidate, from the latest assessment, compared live with the rubric.
  const skillConfig = roleSkillConfig(role, role.criteria);
  const scoringVersions = await db.scoringVersion.findMany({ where: { orgId: auth.orgId, roleId: role.id }, orderBy: { version: "desc" } });
  const currentScoring = scoringVersions[0] ?? null;
  const scoreSnaps = new Map(
    role.applications.map((a) => {
      const p = a.profileScores[0];
      // Only a score for the latest assessment is current; an older assessment's score isn't shown as current.
      const valid = p && a.assessments[0] && p.assessmentId === a.assessments[0].id;
      return [
        a.id,
        valid
          ? { id: p.id, score: p.score, coverage: p.coverage, status: p.status, band: p.band, bandLabel: p.bandLabel, version: p.scoringVersion.version, currentVersion: currentScoring?.version ?? p.scoringVersion.version, createdAt: p.createdAt, createdByName: p.createdByName, trigger: p.trigger }
          : null,
      ] as const;
    }),
  );
  const onOlderVersion = currentScoring ? role.applications.filter((a) => a.assessments[0] && scoreSnaps.get(a.id)?.version !== currentScoring.version).length : 0;
  const skillMatches = new Map(role.applications.map((a) => [a.id, matchForApplication(a, { config: skillConfig, approved, criteriaVersion: role.criteriaVersion })]));
  const notRejected = role.applications.filter((a) => a.stage !== "rejected" && a.decision !== "decline");
  const noMaterial = notRejected.filter((a) => skillMatches.get(a.id)!.noMaterial).length;
  const reassessable = notRejected.filter((a) => {
    const m = skillMatches.get(a.id)!;
    if (m.noMaterial) return false; // nothing to assess until a CV or profile is added
    return !a.assessments[0] || m.stale || m.unassessed > 0 || isStale(a.assessments[0].criteriaSnapshot, approved);
  }).length;
  const status: StatusItem[] = [];
  if (needsReview) status.push({ tone: "attention", text: "Details extracted from the JD need your review", href: `/roles/${role.id}?tab=description`, action: "Review" });
  if (proposed.length) status.push({ tone: "ai", text: `${proposed.length} suggested skill${proposed.length === 1 ? "" : "s"} or criteria awaiting approval`, href: `/roles/${role.id}?tab=criteria`, action: "Review" });
  if (!approved.length && !proposed.length) status.push({ tone: "neutral", text: "No criteria yet", href: `/roles/${role.id}?tab=criteria`, action: "Set up criteria" });
  if (approved.length && unassessed) status.push({ tone: "neutral", text: `${unassessed} candidate${unassessed > 1 ? "s" : ""} not yet assessed` });
  if (outdated) status.push({ tone: "attention", text: `${outdated} assessment${outdated > 1 ? "s" : ""} out of date after skill or criteria changes`, href: `/roles/${role.id}?tab=criteria#reassess`, action: "Reassess" });
  if (awaitingDecision) status.push({ tone: "attention", text: `${awaitingDecision} assessed candidate${awaitingDecision > 1 ? "s" : ""} awaiting your decision`, href: `/roles/${role.id}?tab=applicants`, action: "Review" });
  if (!status.length && role.applications.length) status.push({ tone: "ok", text: `Up to date · ${active.length} active in pipeline` });
  const reviewedFacts = facts.filter((f) => f.status !== "pending" && f.field in LIST_LABEL);

  const inRole = new Set(role.applications.map((a) => a.candidateId));
  const others = tab === "applicants"
    ? (await db.candidate.findMany({ where: { orgId: auth.orgId }, select: { id: true, fullName: true, currentTitle: true }, orderBy: { fullName: "asc" }, take: 500 })).filter((c) => !inRole.has(c.id))
    : [];

  const applicants = role.applications.filter((a) => a.origin !== "discovered");
  const shortlisted = role.applications.filter((a) => a.decision === "advance");
  const toReview = await db.sourcedProfile.count({ where: { orgId: auth.orgId, roleId: role.id, status: "new" } });
  // Text search over applicants: name, title, company, candidate-provided info and current CV text.
  const term = q.trim().slice(0, 100);
  const matchingIds =
    tab === "applicants" && term
      ? new Set(
          (
            await db.candidate.findMany({
              where: {
                orgId: auth.orgId,
                id: { in: applicants.map((a) => a.candidateId) },
                OR: [
                  { fullName: { contains: term, mode: "insensitive" } },
                  { currentTitle: { contains: term, mode: "insensitive" } },
                  { currentCompany: { contains: term, mode: "insensitive" } },
                  { candidateSummary: { contains: term, mode: "insensitive" } },
                  { resumes: { some: { isCurrent: true, pagesJson: { contains: term, mode: "insensitive" } } } },
                ],
              },
              select: { id: true },
            })
          ).map((c) => c.id),
        )
      : null;

  const toView = (c: (typeof role.criteria)[number]): CriterionView => ({ ...c, approvedAt: c.approvedAt?.toISOString() ?? null });
  const approvedSkills = approved.filter((c) => c.kind === "skill");
  const approvedCriteria = approved.filter((c) => c.kind !== "skill");
  const criterionOptions = role.criteria.filter((c) => c.kind === "criterion" && c.status !== "rejected").map((c) => ({ id: c.id, name: c.name }));
  const nameOf = (id: string | null) => (id ? (role.criteria.find((c) => c.id === id)?.name ?? null) : null);
  const ai = aiStatus();

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Roles", href: "/roles" }, { label: role.title }]} />}
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
      {tab !== "overview" && <StatusLine items={status} />}
      {saved === "details" && (
        <Notice tone="ok" className="mb-4">
          Role details saved from your review.{proposed.length > 0 ? " Next, review the criteria proposed from the JD below." : ""}
        </Notice>
      )}
      <RoleTabs
        roleId={role.id}
        active={tab}
        counts={{ applicants: applicants.length, discover: toReview, shortlist: shortlisted.length, criteria: approved.length }}
        attention={{ criteria: proposed.length, description: needsReview ? pendingFacts.length || 1 : 0 }}
        showAts={!!getAtsConnector()}
      />

      {tab === "overview" && (
        <RoleOverview
          orgId={auth.orgId}
          role={{ id: role.id, createdById: role.createdById, createdAt: role.createdAt }}
          criteria={role.criteria.map((c) => ({ id: c.id, name: c.name, importance: c.importance, status: c.status, kind: c.kind }))}
          next={status}
          skills={{
            config: skillConfig,
            matches: notRejected.map((a) => ({ match: skillMatches.get(a.id)!, isSample: a.candidate.isSample, origin: a.origin })),
          }}
        />
      )}

      {tab === "criteria" && (
        <div className="space-y-6">
          {proposed.length > 0 && <ReviewBanner roleId={role.id} count={proposed.length} />}
          <ProposePanel roleId={role.id} aiConfigured={ai.configured} hasDescription={role.description.trim().length >= 40} hasCriteria={role.criteria.length > 0} />

          {proposed.length > 0 && (
            <section>
              <SectionTitle hint="Suggested from the job description. Not used to assess anyone until you approve them.">Suggestions to review</SectionTitle>
              <Card className="divide-y divide-line overflow-hidden">
                {proposed.map((c) => (
                  <CriterionRow key={c.id} c={toView(c)} options={criterionOptions} mappedName={nameOf(c.mappedCriterionId)} />
                ))}
              </Card>
            </section>
          )}

          <section aria-labelledby="skills-h">
            <SectionTitle
              hint="Single named skills. Each candidate gets Evidence found, Partial evidence, No evidence found or Needs recruiter review per skill, from their own material only."
              action={<AddCriterion roleId={role.id} kind="skill" options={criterionOptions} />}
            >
              <span id="skills-h">Skills</span>
            </SectionTitle>
            {approvedSkills.length === 0 ? (
              <EmptyState title="No skills yet" body="Add the skills this role needs, or suggest them from the job description and approve the ones that fit." />
            ) : (
              <div className="space-y-4">
                {(["essential", "preferred"] as const).map((imp) => {
                  const list = approvedSkills.filter((c) => (imp === "preferred" ? c.importance === "preferred" : c.importance !== "preferred"));
                  if (!list.length) return null;
                  return (
                    <div key={imp}>
                      <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                        {imp === "essential" ? "Required skills" : "Preferred skills"} · {list.length}
                      </div>
                      <Card className="divide-y divide-line overflow-hidden">
                        {list.map((c, i) => (
                          <CriterionRow
                            key={c.id}
                            c={toView(c)}
                            options={criterionOptions}
                            mappedName={nameOf(c.mappedCriterionId)}
                            canMoveUp={i > 0}
                            canMoveDown={i < list.length - 1}
                          />
                        ))}
                      </Card>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section id="rubric" className="scroll-mt-6" aria-labelledby="rubric-h">
            <SectionTitle hint="Applied live to every candidate's latest assessment. Changing these doesn't need a reassessment.">
              <span id="rubric-h">Skill threshold and weights</span>
            </SectionTitle>
            <Card className="p-4">
              <RubricForm
                roleId={role.id}
                requiredSkills={skillConfig.requiredSkillIds.length}
                threshold={role.skillThreshold}
                partialCredit={role.skillPartialCredit}
                weightRequired={role.weightRequired}
                weightPreferred={role.weightPreferred}
                updatedBy={role.rubricUpdatedBy ? `${role.rubricUpdatedBy}${role.rubricUpdatedAt ? ` on ${formatDate(role.rubricUpdatedAt)}` : ""}` : null}
              />
            </Card>
          </section>

          <section id="scoring" className="scroll-mt-6" aria-labelledby="scoring-h">
            <SectionTitle hint="This role only. A 0–100 profile score from the approved skills and criteria above and the evidence on file. Labels are advisory — a person always decides.">
              <span id="scoring-h">Scoring</span>
            </SectionTitle>
            <Card className="space-y-4 p-4">
              <ScoringForm
                roleId={role.id}
                bands={parseBands(currentScoring?.bandsJson)}
                minCoverage={currentScoring?.minCoverage ?? 0.6}
                canEdit={auth.membershipRole !== "hiring_manager"}
              />
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 text-[12.5px]">
                <span className="text-muted">
                  {currentScoring ? `Current: version ${currentScoring.version}, by ${currentScoring.createdByName} on ${formatDate(currentScoring.createdAt)}.` : "Version 1 (defaults) is created with the first score."} Weights come from the
                  rubric above; changing them also creates a new version. Saving never rewrites earlier scores.
                </span>
                {currentScoring && auth.membershipRole !== "hiring_manager" && <RecalculateButton roleId={role.id} version={currentScoring.version} outdated={onOlderVersion} />}
              </div>
              {scoringVersions.length > 0 && (
                <details className="text-[12.5px]">
                  <summary className="cursor-pointer text-muted hover:text-ink">Version history ({scoringVersions.length})</summary>
                  <ul className="mt-1.5 space-y-1">
                    {scoringVersions.map((v) => (
                      <li key={v.id}>
                        <span className="font-medium">v{v.version}</span>{" "}
                        <span className="text-muted">
                          {formatDate(v.createdAt)} · {v.createdByName} · weights {v.weightRequired}/{v.weightPreferred} · min coverage {Math.round(v.minCoverage * 100)}% ·{" "}
                          {parseBands(v.bandsJson).map((b) => `${b.label} ≥${b.min}`).join(", ")}
                          {v.note ? ` · ${v.note}` : ""}
                        </span>
                        {v.flaggedAt && !v.flagReviewedAt && <Badge tone="warn" className="ml-1.5">Flagged for review</Badge>}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </Card>
          </section>

          <section aria-labelledby="crit-h">
            <SectionTitle
              hint="Broader evaluation: experience, location, domain knowledge. Required and preferred criteria are weighted; informational ones are shown but never weighted."
              action={<AddCriterion roleId={role.id} kind="criterion" />}
            >
              <span id="crit-h">Evaluation criteria</span>
            </SectionTitle>
            {approvedCriteria.length === 0 ? (
              <EmptyState title="No evaluation criteria" body="Add criteria manually, or suggest them from the job description and approve the ones that fit." />
            ) : (
              <div className="space-y-4">
                {(["essential", "preferred", "informational"] as const).map((imp) => {
                  const list = approvedCriteria.filter((c) => c.importance === imp);
                  if (!list.length) return null;
                  return (
                    <div key={imp}>
                      <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">
                        {IMPORTANCE_LABEL[imp]} · {list.length}
                      </div>
                      <Card className="divide-y divide-line overflow-hidden">
                        {list.map((c, i) => {
                          const mapped = approvedSkills.filter((sk) => sk.mappedCriterionId === c.id);
                          return (
                            <div key={c.id}>
                              <CriterionRow c={toView(c)} canMoveUp={i > 0} canMoveDown={i < list.length - 1} />
                              {mapped.length > 0 && <p className="-mt-2 px-4 pb-2.5 text-[12px] text-muted">Supported by skills: {mapped.map((m) => m.name).join(", ")}</p>}
                            </div>
                          );
                        })}
                      </Card>
                    </div>
                  );
                })}
              </div>
            )}
          </section>

          <section id="reassess" className="scroll-mt-6" aria-labelledby="reassess-h">
            <SectionTitle hint="Runs only when you ask. Uses AI when configured, otherwise the labeled keyword check. Rejected candidates are skipped; decisions and stages never change.">
              <span id="reassess-h">Reassess candidates</span>
            </SectionTitle>
            <Card className="flex flex-wrap items-center justify-between gap-3 p-4 text-[13px]">
              <span className="text-ink-2">
                {approved.length === 0
                  ? "Approve skills or criteria first."
                  : reassessable
                    ? `${reassessable} of ${notRejected.length} candidate${notRejected.length === 1 ? "" : "s"} ${reassessable === 1 ? "is" : "are"} not assessed or assessed against older skills, criteria or candidate information.`
                    : `All ${notRejected.length - noMaterial} active candidate${notRejected.length - noMaterial === 1 ? "" : "s"} with material are assessed against the current skills and criteria.`}
                {noMaterial > 0 && ` ${noMaterial} need${noMaterial === 1 ? "s" : ""} review — no CV, profile or source text to assess yet.`}
              </span>
              {approved.length > 0 && <ReassessButton roleId={role.id} outdated={reassessable} total={notRejected.length} aiConfigured={ai.configured} />}
            </Card>
          </section>

          {approved.length > 0 && (
            <section>
              <SectionTitle
                hint="The same questions for every candidate in this role, so answers can be compared fairly. Never sent to candidates."
                action={
                  <ActionButton action={generateCoreQuestions.bind(null, role.id)} variant="secondary" pendingLabel="Drafting…" successMessage="Core questions proposed">
                    {role.questions.length ? "Regenerate proposals" : "Propose core questions"}
                  </ActionButton>
                }
              >
                Core questions
              </SectionTitle>
              <Card className="px-4">
                <QuestionList
                  questions={role.questions.map((q) => ({ id: q.id, text: q.text, criterionName: q.criterionName, rationale: q.rationale, evidence: JSON.parse(q.evidenceJson), origin: q.origin, status: q.status }))}
                />
              </Card>
            </section>
          )}

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
              {proposed.length} skills and criteria were also suggested from this JD — <Link className="font-medium text-ink underline" href={`/roles/${role.id}?tab=criteria`}>review them on the Criteria tab</Link>.
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

      {tab === "applicants" && (
        <ApplicantsTab
          roleId={role.id}
          applicants={applicants}
          matchingIds={matchingIds}
          filters={{ q: term, stage: stageFilter, review, view, sort, ...skillFilter }}
          approved={approved}
          criteriaVersion={role.criteriaVersion}
          others={others}
          skillMatches={skillMatches}
          requiredSkills={skillConfig.requiredSkillIds.length}
          weights={weightsOf(role)}
          scores={scoreSnaps}
        />
      )}

      {tab === "shortlist" && (
        <ShortlistTab
          roleId={role.id}
          shortlisted={shortlisted}
          origin={origin === "applied" || origin === "discovered" ? origin : ""}
          skillMatches={skillMatches}
          requiredSkills={skillConfig.requiredSkillIds.length}
          skillFilter={skillFilter}
          scores={scoreSnaps}
        />
      )}
    </>
  );
}
