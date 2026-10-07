import clsx from "clsx";
import Link from "next/link";
import { ActionButton } from "@/components/client";
import { StageSelect } from "@/components/stage-select";
import { RoleStatusBadge } from "@/components/status";
import { SummaryLine } from "@/components/summary";
import { Badge, Card, EmptyState, LinkButton, PageHeader, SectionTitle, buttonClass, formatDate } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECISION_LABEL, EMPLOYMENT_TYPE_LABEL, GENERATOR_LABEL, STAGES, STAGE_LABEL, type Decision, type EmploymentType } from "@/lib/domain";
import { isStale, summarize } from "@/lib/summary";
import { deleteRole } from "@/server/role-actions";
import { ownRole } from "@/server/scope";
import { AddExisting } from "./add-existing";
import { AddCriterion, CriterionRow, ProposePanel, ReviewBanner, type CriterionView } from "./criteria";

export const metadata = { title: "Role" };

type Tab = "pipeline" | "criteria" | "description";

export default async function RolePage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ tab?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const { tab: tabParam } = await searchParams;
  await ownRole(auth, id);

  const role = await db.role.findFirstOrThrow({
    where: { id, orgId: auth.orgId },
    include: {
      criteria: { orderBy: [{ priority: "asc" }, { position: "asc" }] },
      applications: {
        include: {
          candidate: { select: { id: true, fullName: true, currentTitle: true, currentCompany: true } },
          assessments: { orderBy: { createdAt: "desc" }, take: 1, include: { items: { select: { importance: true, result: true, overrideResult: true } } } },
        },
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  const approved = role.criteria.filter((c) => c.status === "approved");
  const proposed = role.criteria.filter((c) => c.status === "proposed");
  const rejected = role.criteria.filter((c) => c.status === "rejected");
  const tab: Tab = tabParam === "criteria" || tabParam === "description" || tabParam === "pipeline" ? tabParam : approved.length === 0 ? "criteria" : "pipeline";

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

      <div className="mb-5 flex gap-1 border-b border-line">
        <TabLink href={`/roles/${role.id}?tab=pipeline`} active={tab === "pipeline"} label="Pipeline" count={role.applications.length} />
        <TabLink href={`/roles/${role.id}?tab=criteria`} active={tab === "criteria"} label="Criteria" count={approved.length} attention={proposed.length} />
        <TabLink href={`/roles/${role.id}?tab=description`} active={tab === "description"} label="Job description" />
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
        <Card className="p-6">
          {role.description ? (
            <div className="whitespace-pre-wrap text-[14px] leading-relaxed text-ink-2">{role.description}</div>
          ) : (
            <EmptyState title="No job description" action={<LinkButton href={`/roles/${role.id}/edit`}>Add one</LinkButton>} />
          )}
        </Card>
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
                                    <SummaryLine summary={summarize(asmt.items)} compact />
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
