import Link from "next/link";
import { ActionButton } from "@/components/client";
import { ModeBanner, OriginBadge, RoleTabs, SampleBadge } from "@/components/role-workspace";
import { RoleStatusBadge } from "@/components/status";
import { Badge, Card, EmptyState, Notice, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { getAtsConnector } from "@/lib/ats/connector";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { getEmailProvider } from "@/lib/outreach/provider";
import { REVIEW_STATUS_LABEL, REVIEW_STATUS_TONE, reviewStatus } from "@/lib/review-status";
import { CONNECTORS, isLiveSourceConnected, sourceLabel } from "@/lib/sourcing/connectors";
import { EMPTY_FILTERS, FILTER_LABEL, parseFilters, type SearchFilters } from "@/lib/sourcing/filters";
import { clearSampleData } from "@/server/sourcing-actions";
import { ownRole } from "@/server/scope";
import { DiscoverSearch, ImportExportForm, type SourceOption } from "./discover-search";
import { GenerateIcpButton, IcpApprovedView, IcpDraftEditor, type IcpView } from "./icp-editor";
import { ResultCard, type ProfileView } from "./results";

export const metadata = { title: "Discover" };
// Searches and ICP generation run as server actions on this page.
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

/** Outbound workflow: people a recruiter finds for this role. Kept separate from applicants. */
export default async function DiscoverPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string; view?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const role = await ownRole(auth, id);
  const { run: runParam, view: viewParam = "review" } = await searchParams;
  const view = VIEWS.some(([k]) => k === viewParam) ? viewParam : "review";
  const ai = aiStatus();

  const [criteria, icps, apps, strategies, rediscoverable] = await Promise.all([
    db.criterion.findMany({ where: { roleId: id, orgId: auth.orgId }, select: { status: true } }),
    loadIcps(auth.orgId, id),
    db.application.findMany({
      where: { orgId: auth.orgId, roleId: id },
      select: {
        id: true,
        origin: true,
        originDetail: true,
        decision: true,
        stage: true,
        createdAt: true,
        candidateId: true,
        candidate: { select: { fullName: true, currentTitle: true, currentCompany: true, isSample: true } },
        assessments: { orderBy: { createdAt: "desc" }, take: 1, select: { status: true } },
      },
    }),
    db.searchStrategy.findMany({ where: { orgId: auth.orgId, roleId: id }, orderBy: { version: "desc" }, take: 8, include: { runs: { orderBy: { createdAt: "desc" }, take: 5 } } }),
    db.candidate.count({ where: { orgId: auth.orgId, isSample: false, applications: { none: { roleId: id } } } }),
  ]);
  const approvedCriteria = criteria.filter((c) => c.status === "approved").length;
  const proposedCriteria = criteria.filter((c) => c.status === "proposed").length;
  const draft = icps.find((i) => i.status === "draft");
  const approvedIcp = icps.find((i) => i.status === "approved");

  const allRuns = strategies.flatMap((st) => st.runs.map((r) => ({ ...r, strategyVersion: st.version }))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const currentRun = allRuns.find((r) => r.id === runParam) ?? allRuns.find((r) => r.status === "completed");
  const profiles = currentRun ? await db.sourcedProfile.findMany({ where: { orgId: auth.orgId, runId: currentRun.id } }) : [];
  const toReview = await db.sourcedProfile.count({ where: { orgId: auth.orgId, roleId: id, status: "new" } });
  const appById = new Map(apps.map((a) => [a.id, a]));
  const profileView = (p: (typeof profiles)[number]): ProfileView => ({
    ...p,
    sourceLabel: sourceLabel(p.source),
    retrievedAt: p.retrievedAt.toISOString(),
    fields: JSON.parse(p.fieldsJson),
    signals: JSON.parse(p.signalsJson),
    savedCandidateId: p.savedApplicationId ? (appById.get(p.savedApplicationId)?.candidateId ?? null) : null,
  });
  // Ordering by matched terms is a review aid, not an assessment. Limited/stale evidence is listed separately, unranked.
  const bySignals = (a: (typeof profiles)[number], b: (typeof profiles)[number]) => b.matchedSignals - a.matchedSignals || a.displayName.localeCompare(b.displayName);
  const groups: Record<string, typeof profiles> = {
    review: profiles.filter((p) => p.status === "new" && p.evidenceStatus === "ok").sort(bySignals),
    limited: profiles.filter((p) => p.status === "new" && p.evidenceStatus !== "ok").sort(bySignals),
    saved: profiles.filter((p) => p.status === "saved"),
    dismissed: profiles.filter((p) => p.status === "dismissed"),
    excluded: profiles.filter((p) => p.status === "excluded"),
  };

  // Prefill: last search → approved Ideal Candidate Profile → the role itself.
  const latest = strategies[0];
  let initial: SearchFilters = { ...EMPTY_FILTERS, titles: [role.title], locations: role.location ? [role.location] : [] };
  let initialFrom = "Prefilled from the role title and location — edit before searching.";
  if (latest) {
    initial = parseFilters(latest.filtersJson);
    initialFrom = `Prefilled from your last search (v${latest.version}).`;
  } else if (approvedIcp) {
    const pick = (...cats: string[]) => approvedIcp.items.filter((i) => i.status === "approved" && cats.includes(i.category)).map((i) => i.value);
    initial = { ...EMPTY_FILTERS, titles: pick("target_title"), adjacent_titles: pick("adjacent_title"), skills_required: pick("skill_essential"), skills_preferred: pick("skill_preferred"), locations: pick("location"), seniority: pick("seniority") };
    initialFrom = `Prefilled from the approved Ideal Candidate Profile (v${approvedIcp.version}).`;
  }

  const live = isLiveSourceConnected();
  const sources: SourceOption[] = CONNECTORS.map((c) => ({
    key: c.key,
    label: c.label,
    kind: c.kind,
    available: c.configured(),
    note:
      c.kind === "internal"
        ? `${rediscoverable} existing Talyn candidate${rediscoverable === 1 ? "" : "s"} not in this role`
        : c.kind === "external"
          ? c.configured()
            ? "Licensed provider · live search"
            : "Not connected — Settings → Integrations"
          : c.configured()
            ? "Fictional profiles · not a live search"
            : "Off — a live source is connected",
  }));
  const defaultSource = live ? "external" : rediscoverable > 0 ? "talyn" : "sample";
  const discovered = apps.filter((a) => a.origin === "discovered");
  const sampleCount = apps.filter((a) => a.candidate.isSample).length;
  const isSampleRun = currentRun?.source === "sample";

  return (
    <>
      <PageHeader
        eyebrow={
          <Link href="/roles" className="hover:text-ink">
            Roles
          </Link>
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
        People you find for this role. They haven&apos;t applied, and their interest or availability isn&apos;t known. Saving someone marks them Discovered and adds them to the Shortlist — never to
        Applicants.
      </ModeBanner>

      {!live && (
        <Notice tone="signal" className="mb-4">
          <strong>No live talent source is connected.</strong> Search your existing Talyn candidates (<em>Talyn rediscovery</em>) or <em>sample data</em> — fictional people for exploring this
          workflow, not live search results.{" "}
          <Link href="/settings/integrations" className="font-medium underline">
            Connect a source
          </Link>
        </Notice>
      )}

      <section className="mb-8" aria-labelledby="search-h">
        <SectionTitle hint="Each search is saved as a version so you can see what ran and re-run it.">
          <span id="search-h">Search</span>
        </SectionTitle>
        <DiscoverSearch roleId={role.id} initial={initial} initialFrom={initialFrom} sources={sources} defaultSource={defaultSource} canPlanFromProfile={!!approvedIcp} />
      </section>

      <section id="results" className="mb-8 scroll-mt-6" aria-labelledby="results-h">
        <SectionTitle
          hint={
            currentRun
              ? `Search v${currentRun.strategyVersion} · ${sourceLabel(currentRun.source)} · ${currentRun.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${currentRun.createdByName ? ` · ${currentRun.createdByName}` : ""}`
              : undefined
          }
        >
          <span id="results-h">Results</span>
        </SectionTitle>
        {!currentRun ? (
          <EmptyState title="No search yet" body="Enter a query or filters above and press Search. Results appear here as cards with the evidence behind each match." />
        ) : (
          <>
            {isSampleRun && (
              <Notice tone="warn" className="mb-3">
                <strong>Sample results.</strong> These are fictional people from Talyn&apos;s example list, matched against your terms. They are not live search results and can&apos;t be contacted.
              </Notice>
            )}
            {currentRun.status === "failed" && <Notice tone="danger" className="mb-3">This search failed. Run it again, or choose another source.</Notice>}
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
                : "Ordered by how many of your search terms were found with a quote — a review aid, not an assessment or a score."}
            </p>
            {groups[view].length ? (
              <Card className="divide-y divide-line overflow-hidden">
                {groups[view].map((p) => (
                  <ResultCard key={p.id} p={profileView(p)} emailProviderConnected={!!getEmailProvider()} />
                ))}
              </Card>
            ) : (
              <EmptyState
                title={view === "review" ? "Nothing left to review in this search" : "Nothing here"}
                body={
                  view === "review" && currentRun.resultCount === 0
                    ? isSampleRun
                      ? "None of the sample profiles match these terms. Sample data covers a small set of fictional engineering, data, design, product, recruiting, sales, finance and HR profiles — try broader terms."
                      : "No profiles matched. Try broader titles, fewer required skills, or another source."
                    : undefined
                }
              />
            )}
          </>
        )}
      </section>

      <section className="mb-8" aria-labelledby="saved-h">
        <SectionTitle hint="People saved from Discover for this role. Open one for the shared candidate view; your decision there is separate from how they were found.">
          <span id="saved-h">Saved from Discover</span>
        </SectionTitle>
        {discovered.length === 0 ? (
          <p className="text-[13px] text-muted">No one saved yet.</p>
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {discovered.map((a) => {
              const st = reviewStatus(a);
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
                      {[a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(" · ") || "No current role on record"} · saved {formatDate(a.createdAt)}
                    </div>
                  </div>
                  <Badge tone={REVIEW_STATUS_TONE[st]}>{REVIEW_STATUS_LABEL[st]}</Badge>
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
            {strategies.map((st) =>
              st.runs.map((r) => {
                const f = parseFilters(st.filtersJson);
                return (
                  <li key={r.id} className="flex flex-wrap gap-x-2">
                    <Link href={`/roles/${role.id}/discover?run=${r.id}#results`} className={r.id === currentRun?.id ? "font-medium text-ink" : "text-muted hover:text-ink"}>
                      v{st.version} · {r.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {sourceLabel(r.source)}
                    </Link>
                    <span className="text-faint">
                      {r.status === "completed" ? `${r.resultCount} results${r.excludedCount ? ` · ${r.excludedCount} set aside` : ""}` : r.status === "setup_required" ? "source not connected" : "failed"}
                    </span>
                    <span className="truncate text-faint">
                      ·{" "}
                      {(Object.keys(FILTER_LABEL) as (keyof SearchFilters)[])
                        .filter((k) => f[k].length)
                        .map((k) => `${FILTER_LABEL[k]}: ${f[k].join(", ")}`)
                        .join(" · ")}
                    </span>
                  </li>
                );
              }),
            )}
          </ul>
        </details>
      )}

      <details className="mb-6 rounded-xl border border-line bg-surface p-4 text-[13px]" open={!!draft}>
        <summary className="cursor-pointer font-medium">Ideal Candidate Profile {approvedIcp ? `· v${approvedIcp.version} approved` : draft ? "· draft to review" : "· optional"}</summary>
        <p className="mt-1 text-[12.5px] text-muted">Who to look for, built from the approved criteria and JD. Once approved, use “Fill from Ideal Candidate Profile” in the search form.</p>
        <div className="mt-3">
          {approvedCriteria === 0 ? (
            <p className="text-muted">
              Approve criteria first —{" "}
              <Link className="underline" href={`/roles/${role.id}?tab=criteria`}>
                go to Criteria
              </Link>
              .
            </p>
          ) : draft ? (
            <>
              <div className="mb-3 flex items-center gap-3 text-[12.5px] text-muted">
                <span>Draft v{draft.version}</span>
                <span className="ml-auto">
                  <GenerateIcpButton roleId={role.id} aiConfigured={ai.configured} label="Regenerate draft" />
                </span>
              </div>
              <IcpDraftEditor icp={toView(draft)} roleCriteriaVersion={role.criteriaVersion} />
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

      {latest && (
        <details className="mb-6 rounded-xl border border-line bg-surface p-4 text-[13px]">
          <summary className="cursor-pointer font-medium">Import an authorized export</summary>
          <div className="mt-3">
            <ImportExportForm strategyId={latest.id} version={latest.version} />
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
