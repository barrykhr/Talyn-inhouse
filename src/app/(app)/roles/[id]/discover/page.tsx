import Link from "next/link";
import { ActionButton } from "@/components/client";
import { AgentRun, type AgentStep } from "@/components/agent-run";
import { ModeBanner, OriginBadge, RoleTabs, SampleBadge } from "@/components/role-workspace";
import { RoleStatusBadge } from "@/components/status";
import { DiscoverJdFlow } from "@/components/upload-flows";
import { Badge, Breadcrumbs, Card, EmptyState, LinkButton, Notice, PageHeader, SectionTitle, buttonClass, formatDate } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { getAtsConnector } from "@/lib/ats/connector";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { EMPTY_BRIEF } from "@/lib/discovery/brief";
import { briefFields, briefProvenance } from "@/lib/discovery/store";
import { REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE, reviewStatus } from "@/lib/review-status";
import { CONNECTORS, isLiveSourceConnected, sourceLabel } from "@/lib/sourcing/connectors";
import { THRESHOLD_FILTERS, matchForApplication, passesSkillFilter, roleSkillConfig } from "@/lib/skills";
import { SkillCount, SkillFilterFields } from "@/components/skill-match";
import { ProfileScoreChip } from "@/components/profile-score";
import { clearSampleData } from "@/server/sourcing-actions";
import { loadOutreachView } from "@/server/outreach-view";
import { ownRole } from "@/server/scope";
import { OutreachPanel } from "../../../candidates/[id]/outreach";
import { DiscoverSetupForm, type SourceOption } from "./discover-setup";
import { GenerateIcpButton, IcpApprovedView, IcpDraftEditor, type IcpView } from "./icp-editor";
import { ImportExportForm } from "./import-export";
import { ResultCard, type ProfileView } from "./results";
import { PoolEstimatePanel } from "./pool-estimate";

export const metadata = { title: "Discover" };
// Searches, JD extraction and outreach drafting run as server actions on this page.
export const maxDuration = 300;

type IcpWithItems = Awaited<ReturnType<typeof loadIcps>>[number];
async function loadIcps(orgId: string, roleId: string) {
  return db.icp.findMany({ where: { orgId, roleId, status: { in: ["draft", "approved"] } }, include: { items: { orderBy: { position: "asc" } } }, orderBy: { version: "desc" } });
}
function toView(i: IcpWithItems): IcpView {
  return {
    id: i.id,
    version: i.version,
    status: i.status,
    generator: i.generator,
    criteriaVersion: i.criteriaVersion,
    approvedByName: i.approvedByName,
    approvedAt: i.approvedAt?.toISOString() ?? null,
    clarifications: JSON.parse(i.clarificationsJson),
    items: i.items,
  };
}

const VIEWS = [
  ["review", "To review"],
  ["limited", "Limited evidence"],
  ["saved", "Saved"],
  ["dismissed", "Dismissed"],
  ["excluded", "Set aside by exclusions"],
] as const;

type SourceStatus = { key: string; label: string; status: "ok" | "error" | "setup_required"; count: number; error?: string };

/** Outbound workflow for one role: set up the search, choose sources, review people, reach out. */
export default async function DiscoverPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ run?: string; view?: string; outreach?: string; setup?: string; skills?: string; minskills?: string }>;
}) {
  const auth = await requireAuth();
  const { id } = await params;
  const role = await ownRole(auth, id);
  const { run: runParam, view: viewParam = "review", outreach: outreachParam, setup, skills: skillsParam = "", minskills: minParam = "" } = await searchParams;
  const skillFilter = { skills: (THRESHOLD_FILTERS as readonly string[]).includes(skillsParam) ? skillsParam : "", minskills: /^\d{1,2}$/.test(minParam) ? minParam : "" };
  const view = VIEWS.some(([k]) => k === viewParam) ? viewParam : "review";
  const ai = aiStatus();

  const [criteria, icps, apps, strategies, rediscoverable, brief, jd] = await Promise.all([
    db.criterion.findMany({ where: { roleId: id, orgId: auth.orgId }, select: { id: true, status: true, kind: true, importance: true, updatedAt: true } }),
    loadIcps(auth.orgId, id),
    db.application.findMany({
      where: { orgId: auth.orgId, roleId: id },
      select: {
        id: true,
        origin: true,
        originDetail: true,
        decision: true,
        stage: true,
        interest: true,
        createdAt: true,
        candidateId: true,
        sourcedProfileId: true,
        candidate: {
          select: {
            fullName: true,
            currentTitle: true,
            currentCompany: true,
            candidateSummary: true,
            isSample: true,
            contactOptOut: true,
            whatsappPermission: true,
            resumes: { where: { isCurrent: true }, select: { id: true }, take: 1 },
          },
        },
        assessments: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { id: true, status: true, criteriaSnapshot: true, criteriaVersion: true, resumeId: true, profileHash: true, items: { select: { criterionId: true, kind: true, importance: true, result: true, overrideResult: true } } },
        },
        profileScores: { orderBy: { createdAt: "desc" }, take: 1, include: { scoringVersion: { select: { version: true } } } },
        outreach: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true, channel: true } },
      },
    }),
    db.searchStrategy.findMany({ where: { orgId: auth.orgId, roleId: id }, orderBy: { version: "desc" }, take: 8, include: { runs: { orderBy: { createdAt: "desc" }, take: 5 } } }),
    db.candidate.count({ where: { orgId: auth.orgId, isSample: false, applications: { none: { roleId: id } } } }),
    db.discoveryBrief.findUnique({ where: { roleId: id } }),
    db.jobDescription.findFirst({ where: { roleId: id, orgId: auth.orgId, isCurrent: true }, select: { id: true, fileName: true, createdAt: true, pagesJson: true } }),
  ]);
  const approvedCriteria = criteria.filter((c) => c.status === "approved").length;
  const skillConfig = roleSkillConfig(role, criteria);
  const approvedList = criteria.filter((c) => c.status === "approved");
  const proposedCriteria = criteria.filter((c) => c.status === "proposed").length;
  const draftIcp = icps.find((i) => i.status === "draft");
  const approvedIcp = icps.find((i) => i.status === "approved");

  const allRuns = strategies.flatMap((st) => st.runs.map((r) => ({ ...r, strategyVersion: st.version }))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const currentRun = allRuns.find((r) => r.id === runParam) ?? allRuns[0];
  const runSources = currentRun ? (JSON.parse(currentRun.sourcesJson) as SourceStatus[]) : [];
  const profiles = currentRun ? await db.sourcedProfile.findMany({ where: { orgId: auth.orgId, runId: currentRun.id } }) : [];
  const toReview = await db.sourcedProfile.count({ where: { orgId: auth.orgId, roleId: id, status: "new" } });
  const appById = new Map(apps.map((a) => [a.id, a]));
  const permissionText = (a: (typeof apps)[number]) =>
    a.candidate.isSample ? "Fictional — no one to contact" : a.candidate.contactOptOut ? "Opted out" : a.candidate.whatsappPermission === "granted" ? "WhatsApp opt-in recorded" : a.origin === "applied" ? "Applied to this role" : "Not recorded";
  const profileView = (p: (typeof profiles)[number]): ProfileView => {
    const app = p.savedApplicationId ? appById.get(p.savedApplicationId) : undefined;
    return {
      ...p,
      sourceLabel: sourceLabel(p.source),
      retrievedAt: p.retrievedAt.toISOString(),
      fields: JSON.parse(p.fieldsJson),
      signals: JSON.parse(p.signalsJson),
      sources: JSON.parse(p.sourcesJson),
      isDemo: p.source === "sample",
      savedCandidateId: app?.candidateId ?? null,
      application: app ? { interest: app.interest, permission: permissionText(app) } : null,
    };
  };
  // Ordering by matched terms is a review aid, not an assessment. Limited evidence is listed separately, unranked.
  const bySignals = (a: (typeof profiles)[number], b: (typeof profiles)[number]) => b.matchedSignals - a.matchedSignals || a.displayName.localeCompare(b.displayName);
  const groups: Record<string, typeof profiles> = {
    review: profiles.filter((p) => p.status === "new" && p.evidenceStatus === "ok").sort(bySignals),
    limited: profiles.filter((p) => p.status === "new" && p.evidenceStatus !== "ok").sort(bySignals),
    saved: profiles.filter((p) => p.status === "saved"),
    dismissed: profiles.filter((p) => p.status === "dismissed"),
    excluded: profiles.filter((p) => p.status === "excluded"),
  };

  const fields = brief ? briefFields(brief) : { ...EMPTY_BRIEF, roleName: role.title.startsWith("Untitled role") ? "" : role.title, location: role.location || null };
  const live = isLiveSourceConnected();
  const sources: SourceOption[] = CONNECTORS.map((c) => ({
    key: c.key,
    label: c.label,
    kind: c.kind,
    configured: c.configured(),
    note:
      c.kind === "internal"
        ? `${rediscoverable} existing Talyn candidate${rediscoverable === 1 ? "" : "s"} not in this role`
        : c.kind === "external"
          ? c.configured()
            ? "Licensed provider · live search"
            : "Add the provider's credentials to search it"
          : "Fictional people · not a live search",
  }));
  const discoveredAll = apps.filter((a) => a.origin === "discovered");
  const currentScoringVersion = (await db.scoringVersion.findFirst({ where: { orgId: auth.orgId, roleId: id }, orderBy: { version: "desc" }, select: { version: true } }))?.version ?? 1;
  const skillMatches = new Map(discoveredAll.map((a) => [a.id, matchForApplication(a, { config: skillConfig, approved: approvedList, criteriaVersion: role.criteriaVersion })]));
  const discovered = discoveredAll.filter((a) => passesSkillFilter(skillMatches.get(a.id), skillFilter));
  const sampleCount = apps.filter((a) => a.candidate.isSample).length;
  const outreachApp = outreachParam ? appById.get(outreachParam) : undefined;
  const outreach = outreachApp ? await loadOutreachView(auth, outreachApp.id) : null;
  const runQs = currentRun ? `run=${currentRun.id}&` : "";
  const outreachHref = (appId: string | null) => (appId ? `/roles/${role.id}/discover?${runQs}view=${view}&outreach=${appId}#outreach` : null);
  const extractorLabel = brief?.extractor ? (brief.extractor.startsWith("ai:") ? `AI (${brief.extractor.split(":")[2]?.split("/")[0]})` : "basic parser (no AI)") : null;

  // The discovery sequence, derived from stored records: setup → plan → sources → evidence → review.
  const okSources = runSources.filter((s) => s.status === "ok");
  const failedSources = runSources.filter((s) => s.status !== "ok");
  const evidenceOk = profiles.filter((p) => p.evidenceStatus === "ok").length;
  const fresh = !!currentRun && !runParam && Date.now() - currentRun.createdAt.getTime() < 120_000;
  const steps: AgentStep[] = [
    {
      key: "criteria",
      label: "Review role criteria",
      state: brief?.confirmedAt ? "done" : brief ? "active" : "pending",
      detail: brief?.confirmedAt
        ? `Search fields confirmed${brief.confirmedByName ? ` by ${brief.confirmedByName}` : ""}. ${approvedCriteria} approved role criteri${approvedCriteria === 1 ? "on" : "a"}.`
        : brief
          ? "Fields were suggested from the JD. A recruiter confirms them before any search."
          : "Upload a JD or fill in the search fields.",
      fix: brief?.confirmedAt ? undefined : { label: "Open search setup", href: "#setup" },
    },
    {
      key: "plan",
      label: "Prepare search plan",
      state: brief?.booleanQuery ? (brief.confirmedAt ? "done" : "active") : "pending",
      detail: brief?.booleanQuery ? (
        <>
          {brief.booleanEdited ? "Boolean edited by a recruiter" : "Boolean built from the fields"}: <code className="break-all font-mono text-[11.5px] text-muted">{brief.booleanQuery.slice(0, 220)}</code>
        </>
      ) : (
        "Built from the confirmed fields; editable before it runs."
      ),
      fix: brief?.booleanQuery ? { label: "Edit plan", href: "#setup" } : undefined,
    },
    {
      key: "search",
      label: "Search connected sources",
      state: !currentRun ? "pending" : currentRun.status === "failed" || (runSources.length > 0 && okSources.length === 0) ? "blocked" : "done",
      detail: !currentRun
        ? live
          ? "Runs only when you press Search."
          : "No external provider is connected — live searches cover your existing Talyn candidates; Demo mode uses fictional people."
        : failedSources.length
          ? `${failedSources.map((s) => `${s.label} ${s.status === "error" ? "failed" : "not connected"}`).join(", ")}. Nothing was substituted.`
          : currentRun.isDemo
            ? "Demo run against fictional sample people — not a live search."
            : `Searched ${currentRun.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${currentRun.createdByName ? ` by ${currentRun.createdByName}` : ""}.`,
      sources: runSources.map((s) => ({ label: s.label, note: s.status === "ok" ? `${s.count} found` : s.status === "error" ? "error" : "not connected" })),
      fix: failedSources.length ? { label: "Check integrations", href: "/integrations" } : undefined,
    },
    {
      key: "evidence",
      label: "Gather evidence",
      state: !currentRun ? "pending" : currentRun.status === "completed" ? "done" : "blocked",
      detail: currentRun?.status === "completed" ? `${evidenceOk} with quoted evidence, ${profiles.length - evidenceOk} with limited evidence${currentRun.excludedCount ? `, ${currentRun.excludedCount} set aside by your exclusions` : ""}. Each card links to its source and retrieval date.` : undefined,
    },
    {
      key: "review",
      label: "Present results for recruiter review",
      state: !currentRun || currentRun.status !== "completed" ? "pending" : groups.review.length + groups.limited.length ? "active" : "done",
      detail:
        currentRun?.status === "completed"
          ? groups.review.length + groups.limited.length
            ? `${groups.review.length + groups.limited.length} waiting for you to save or dismiss. Nothing is saved, contacted or rejected automatically.`
            : `Reviewed: ${groups.saved.length} saved, ${groups.dismissed.length} dismissed.`
          : undefined,
      fix: groups.review.length + groups.limited.length ? { label: "Review results", href: "#results" } : undefined,
    },
  ];

  return (
    <>
      <PageHeader
        eyebrow={
          <Breadcrumbs
            items={[
              { label: "Roles", href: "/roles" },
              { label: role.title, href: `/roles/${role.id}` },
              { label: "Discover" },
            ]}
          />
        }
        title={
          <span className="flex flex-wrap items-center gap-2">
            {role.title} <RoleStatusBadge status={role.status} />
          </span>
        }
        meta={
          <>
            {role.department && <span>{role.department}</span>}
            {role.location && <span>{role.location}</span>}
          </>
        }
      />
      <RoleTabs
        roleId={role.id}
        active="discover"
        counts={{ applicants: apps.filter((a) => a.origin !== "discovered").length, discover: toReview, shortlist: apps.filter((a) => a.decision === "advance").length, criteria: approvedCriteria }}
        attention={{ criteria: proposedCriteria }}
        showAts={!!getAtsConnector()}
      />

      <ModeBanner mode="discover">
        People you find for this role. They haven&apos;t applied, and their interest isn&apos;t known. Saving someone marks them Discovered; nothing is sent or decided automatically.
      </ModeBanner>

      {!live && (
        <Notice tone="signal" className="mb-4">
          <strong>No external talent provider is connected.</strong> Live searches cover your existing Talyn candidates. Use <em>Demo mode</em> to try the workflow with fictional people — demo results
          are never shown as live.{" "}
          <Link href="/integrations" className="font-medium underline">
            Connect a provider
          </Link>
        </Notice>
      )}

      <AgentRun
        className="mb-6"
        title="Discovery for this role"
        summary="Each step runs only when you ask. You review every result before anyone is saved or contacted."
        steps={steps}
        controls={
          <>
            <LinkButton href="#setup">{currentRun ? "Edit plan & run again" : "Edit plan"}</LinkButton>
            {groups.review.length + groups.limited.length > 0 && <LinkButton href="#results" variant="primary">Review results</LinkButton>}
          </>
        }
      />

      <section id="setup" className="mb-8 scroll-mt-6" aria-labelledby="setup-h">
        <SectionTitle
          hint={
            brief?.confirmedAt
              ? `Confirmed ${formatDate(brief.confirmedAt)}${brief.confirmedByName ? ` by ${brief.confirmedByName}` : ""}${extractorLabel ? ` · suggested from the JD by ${extractorLabel}` : ""}`
              : brief
                ? `Suggested from the JD by ${extractorLabel ?? "Talyn"} — review every field, then save or search`
                : "Upload a job description to suggest these fields, or fill them in yourself."
          }
        >
          <span id="setup-h">Search setup</span>
        </SectionTitle>
        {setup === "jd" && brief && !brief.confirmedAt && (
          <Notice tone="ok" className="mb-3">
            Fields suggested from the JD. Green labels quote the JD; amber ones are suggestions to check; grey ones weren&apos;t stated and are left empty.
          </Notice>
        )}

        <Card className="mb-3 p-4">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
            <span className="font-medium">Job description</span>
            {jd ? (
              <>
                <a href={`/api/jds/${jd.id}`} target="_blank" rel="noopener" className="underline-offset-2 hover:underline">
                  {jd.fileName}
                </a>
                <span className="text-faint">uploaded {formatDate(jd.createdAt)}</span>
              </>
            ) : (
              <span className="text-muted">None uploaded</span>
            )}
          </div>
          {jd && (
            <details className="mt-2 text-[12.5px]">
              <summary className="cursor-pointer text-muted hover:text-ink">Review the JD text</summary>
              <div className="mt-2 max-h-80 overflow-y-auto whitespace-pre-wrap rounded-md bg-sunken/60 p-3 leading-relaxed text-ink-2">{(JSON.parse(jd.pagesJson) as string[]).join("\n\n")}</div>
            </details>
          )}
          <details className="mt-2 text-[12.5px]" open={!jd && !brief}>
            <summary className="cursor-pointer font-medium text-ink-2">{jd ? "Replace the JD" : "Upload a JD to suggest the fields"}</summary>
            <div className="mt-3">
              <DiscoverJdFlow roleId={role.id} compact />
              {jd && <p className="mt-2 text-[12px] text-muted">Fields you edited are kept; the others are re-suggested from the new JD for you to review.</p>}
            </div>
          </details>
        </Card>

        <Card className="p-4 sm:p-5">
          <DiscoverSetupForm
            key={brief?.updatedAt.toISOString() ?? "new"}
            roleId={role.id}
            fields={fields}
            provenance={brief ? briefProvenance(brief) : {}}
            booleanQuery={brief?.booleanQuery}
            booleanEdited={brief?.booleanEdited ?? false}
            booleanKey={brief?.booleanFieldsKey ?? null}
            sources={sources}
            confirmed={!!brief?.confirmedAt}
          />
        </Card>
      </section>

      <div className="mb-8">
        <PoolEstimatePanel roleId={role.id} hasRequired={fields.skillsRequired.length > 0 && !!brief} />
      </div>

      <section id="results" className="mb-8 scroll-mt-6" aria-labelledby="results-h">
        <SectionTitle
          hint={
            currentRun
              ? `Search v${currentRun.strategyVersion} · ${currentRun.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${currentRun.createdByName ? ` · ${currentRun.createdByName}` : ""}`
              : undefined
          }
        >
          <span id="results-h" className="flex flex-wrap items-center gap-2">
            Results
            {currentRun && (currentRun.isDemo ? <Badge tone="warn">Demo — sample data</Badge> : <Badge tone="ok">Live search</Badge>)}
          </span>
        </SectionTitle>
        {!currentRun ? (
          <EmptyState title="No search yet" body="Confirm the fields above, choose sources and search. Each person appears with the evidence and source behind the match." />
        ) : (
          <>
            {runSources.length > 0 && (
              <ul className="mb-3 flex flex-wrap gap-2 text-[12.5px]" aria-label="Sources searched">
                {runSources.map((s) => (
                  <li
                    key={s.key}
                    className={
                      s.status === "ok" ? "rounded-md bg-ok-soft px-2 py-0.5 text-ok" : s.status === "error" ? "rounded-md bg-danger-soft px-2 py-0.5 text-danger" : "rounded-md bg-sunken px-2 py-0.5 text-muted"
                    }
                  >
                    {s.label}: {s.status === "ok" ? `${s.count} found` : s.status === "error" ? `failed — ${s.error}` : "not connected"}
                  </li>
                ))}
              </ul>
            )}
            {runSources.some((s) => s.status === "error") && (
              <Notice tone="danger" className="mb-3">
                {runSources.filter((s) => s.status === "error").map((s) => s.label).join(", ")} returned an error, so no results from {runSources.filter((s) => s.status === "error").length > 1 ? "them" : "it"} are shown.
                Nothing was substituted. Try again later, or check the connection in Integrations.
              </Notice>
            )}
            {currentRun.isDemo && (
              <Notice tone="warn" className="mb-3">
                <strong>Demo results.</strong> Fictional people from Talyn&apos;s sample list, matched against your fields. Not a live search; they can&apos;t be contacted.
              </Notice>
            )}
            <nav className="mb-3 flex flex-wrap gap-1 text-[13px]" aria-label="Result filters">
              {VIEWS.map(([k, label]) => (
                <Link
                  key={k}
                  href={`/roles/${role.id}/discover?run=${currentRun.id}&view=${k}#results`}
                  aria-current={view === k ? "page" : undefined}
                  className={view === k ? "rounded-lg bg-ink px-2.5 py-1 font-medium text-white" : "rounded-lg px-2.5 py-1 text-muted hover:bg-sunken hover:text-ink"}
                >
                  {label} <span className="tabular-nums opacity-70">{groups[k].length}</span>
                </Link>
              ))}
            </nav>
            <p className="mb-2 text-[12px] text-faint">
              {view === "limited"
                ? "Little profile text, no date, or an old profile: listed unranked rather than forcing an order."
                : "Ordered by how many search terms were found with a quote — a review aid, not a score. People found in several sources are merged into one card."}
            </p>
            {groups[view].length ? (
              <Card className={fresh ? "motion-arrive divide-y divide-line overflow-hidden" : "divide-y divide-line overflow-hidden"}>
                {groups[view].map((p) => (
                  <ResultCard key={p.id} p={profileView(p)} outreachHref={outreachHref(p.savedApplicationId)} />
                ))}
              </Card>
            ) : (
              <EmptyState
                title={currentRun.status === "failed" ? "No results — every source failed" : view === "review" ? "Nothing left to review in this search" : "Nothing here"}
                body={
                  currentRun.status === "failed"
                    ? "See the source errors above. No sample or cached data is shown in place of a failed live search."
                    : view === "review" && currentRun.resultCount === 0
                      ? currentRun.isDemo
                        ? "None of the sample people match these fields. The sample list covers a small set of fictional engineering, data, design, product, recruiting, sales, finance and HR profiles."
                        : "No one matched. Try fewer required skills, more alternative titles, or another source."
                      : undefined
                }
              />
            )}
          </>
        )}
      </section>

      {outreachParam && (
        <section id="outreach" className="mb-8 scroll-mt-6" aria-labelledby="outreach-h">
          <SectionTitle
            hint="Draft, review and approve. Nothing is sent until you activate, and follow-ups stop on a reply, decline, opt-out or pause."
            action={
              <Link href={`/roles/${role.id}/discover?${runQs}view=${view}#results`} className="text-[13px] text-muted underline hover:text-ink">
                Close
              </Link>
            }
          >
            <span id="outreach-h">Outreach — {outreach?.candidateName ?? "not found"}</span>
          </SectionTitle>
          {outreach ? (
            <OutreachPanel v={outreach} />
          ) : (
            <EmptyState title="Candidate not found in this role" body="Save the person to the role first, then open outreach from their card." />
          )}
        </section>
      )}

      <section className="mb-8" aria-labelledby="saved-h">
        <SectionTitle hint="People saved from Discover. Required-skill evidence, expressed interest and contact permission are tracked separately. Skill counts use their linked source record and any CV you add.">
          <span id="saved-h">Saved from Discover</span>
        </SectionTitle>
        {discoveredAll.length > 0 && (
          <form className="mb-2 flex flex-wrap items-center gap-2 text-[13px]" aria-label="Filter saved people by skills">
            <SkillFilterFields skills={skillFilter.skills} minskills={skillFilter.minskills} required={skillConfig.requiredSkillIds.length} compact />
            <button className={buttonClass("secondary", "sm")}>Apply</button>
            {(skillFilter.skills || skillFilter.minskills) && (
              <Link href={`/roles/${role.id}/discover#saved-h`} className="text-muted hover:text-ink">
                Clear
              </Link>
            )}
          </form>
        )}
        {discoveredAll.length === 0 ? (
          <p className="text-[13px] text-muted">No one saved yet. Results above aren&apos;t assessed until you save them; then each gets a per-skill evidence check.</p>
        ) : discovered.length === 0 ? (
          <p className="text-[13px] text-muted">No saved people match these filters.</p>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {discovered.map((a) => {
              const st = reviewStatus(a);
              const seq = a.outreach[0];
              return (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Link href={`/candidates/${a.candidateId}?role=${role.id}`} className="font-medium hover:underline">
                        {a.candidate.fullName}
                      </Link>
                      <OriginBadge origin={a.origin} detail={a.originDetail} />
                      {a.candidate.isSample && <SampleBadge />}
                    </div>
                    <div className="text-[12px] text-muted">
                      {[a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(" · ") || "No current role on record"} · saved {formatDate(a.createdAt)} · interest:{" "}
                      {a.interest.replace("_", " ")} · permission: {permissionText(a).toLowerCase()}
                      {seq ? ` · ${seq.channel === "whatsapp" ? "WhatsApp" : "email"} outreach ${seq.status}` : ""}
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    <Link href={`/candidates/${a.candidateId}?role=${role.id}#skills`} className="rounded-md hover:bg-sunken/60" aria-label={`Skill evidence for ${a.candidate.fullName}`}>
                      {skillMatches.get(a.id) && <SkillCount m={skillMatches.get(a.id)!} />}
                    </Link>
                    {a.assessments[0] && (() => {
                      const p = a.profileScores[0];
                      const ok = p && p.assessmentId === a.assessments[0].id;
                      return (
                        <ProfileScoreChip
                          s={ok ? { id: p.id, score: p.score, coverage: p.coverage, status: p.status, band: p.band, bandLabel: p.bandLabel, version: p.scoringVersion.version, currentVersion: currentScoringVersion, createdAt: p.createdAt, createdByName: p.createdByName, trigger: p.trigger } : null}
                        />
                      );
                    })()}
                    <Badge tone={REVIEW_STATUS_TONE[st]}>{REVIEW_STATUS_LABEL[st]}</Badge>
                    <Link href={outreachHref(a.id)!} className="rounded-lg border border-line-strong px-2.5 py-1 text-[12.5px] font-medium hover:bg-sunken">
                      Outreach
                    </Link>
                  </div>
                </div>
              );
            })}
          </Card>
        )}
      </section>

      {allRuns.length > 0 && (
        <details className="mb-6 rounded-xl border border-line bg-surface p-4 text-[13px]">
          <summary className="cursor-pointer font-medium">Search history ({allRuns.length})</summary>
          <ul className="mt-2 space-y-1">
            {allRuns.map((r) => (
              <li key={r.id} className="flex flex-wrap gap-x-2">
                <Link href={`/roles/${role.id}/discover?run=${r.id}#results`} className={r.id === currentRun?.id ? "font-medium text-ink" : "text-muted hover:text-ink"}>
                  v{r.strategyVersion} · {r.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {r.source.split("+").map(sourceLabel).join(", ")}
                </Link>
                {r.isDemo && <Badge tone="warn">Demo</Badge>}
                <span className="text-faint">{r.status === "completed" ? `${r.resultCount} people${r.excludedCount ? ` · ${r.excludedCount} set aside` : ""}` : r.status === "setup_required" ? "source not connected" : "failed"}</span>
                {r.query && <code className="truncate font-mono text-[11.5px] text-faint">{r.query}</code>}
              </li>
            ))}
          </ul>
        </details>
      )}

      <details className="mb-6 rounded-xl border border-line bg-surface p-4 text-[13px]" open={!!draftIcp}>
        <summary className="cursor-pointer font-medium">Ideal Candidate Profile {approvedIcp ? `· v${approvedIcp.version} approved` : draftIcp ? "· draft to review" : "· optional"}</summary>
        <p className="mt-1 text-[12.5px] text-muted">Who to look for, built from the approved criteria and JD. Optional — Discover searches use the setup fields above.</p>
        <div className="mt-3">
          {approvedCriteria === 0 ? (
            <p className="text-muted">
              Approve criteria first —{" "}
              <Link className="underline" href={`/roles/${role.id}?tab=criteria`}>
                go to Criteria
              </Link>
              .
            </p>
          ) : draftIcp ? (
            <>
              <div className="mb-3 flex items-center gap-3 text-[12.5px] text-muted">
                <span>Draft v{draftIcp.version}</span>
                <span className="ml-auto">
                  <GenerateIcpButton roleId={role.id} aiConfigured={ai.configured} label="Regenerate draft" />
                </span>
              </div>
              <IcpDraftEditor icp={toView(draftIcp)} roleCriteriaVersion={role.criteriaVersion} />
            </>
          ) : approvedIcp ? (
            <>
              <IcpApprovedView icp={toView(approvedIcp)} roleCriteriaVersion={role.criteriaVersion} />
              <div className="mt-3">
                <GenerateIcpButton roleId={role.id} aiConfigured={ai.configured} label="Generate a new version" />
              </div>
            </>
          ) : (
            <GenerateIcpButton roleId={role.id} aiConfigured={ai.configured} label="Generate profile" />
          )}
        </div>
      </details>

      {strategies[0] && (
        <details className="mb-6 rounded-xl border border-line bg-surface p-4 text-[13px]">
          <summary className="cursor-pointer font-medium">Import an authorized export</summary>
          <div className="mt-3">
            <ImportExportForm strategyId={strategies[0].id} version={strategies[0].version} />
          </div>
        </details>
      )}

      {sampleCount > 0 && (
        <div className="flex flex-wrap items-center gap-3 rounded-xl border border-dashed border-warn/50 p-4 text-[13px]">
          <span className="text-ink-2">
            {sampleCount} fictional sample {sampleCount === 1 ? "person is" : "people are"} saved to this role.
          </span>
          <ActionButton action={clearSampleData.bind(null, role.id)} confirm="Remove every fictional sample candidate from this workspace?" pendingLabel="Removing…" successMessage="Sample data removed">
            Remove sample data
          </ActionButton>
        </div>
      )}
    </>
  );
}
