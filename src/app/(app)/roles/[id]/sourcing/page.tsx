import Link from "next/link";
import { Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ownRole } from "@/server/scope";
import { CONNECTORS, sourceLabel } from "@/lib/sourcing/connectors";
import { FILTER_LABEL, type SearchFilters } from "@/lib/sourcing/filters";
import { GenerateIcpButton, IcpApprovedView, IcpDraftEditor, type IcpView } from "./icp-editor";
import { ResultRow, type ProfileView } from "./results";
import { ImportExportForm, RunSearchButton, StrategyPlanner } from "./strategy";

export const metadata = { title: "Sourcing" };
// ICP generation and searches run as server actions on this page.
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

export default async function SourcingPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ run?: string; view?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const role = await ownRole(auth, id);
  const [approvedCriteria, icps] = await Promise.all([db.criterion.count({ where: { roleId: id, orgId: auth.orgId, status: "approved" } }), loadIcps(auth.orgId, id)]);
  const draft = icps.find((i) => i.status === "draft");
  const approved = icps.find((i) => i.status === "approved");
  const ai = aiStatus();
  const { run: runParam, view = "review" } = await searchParams;
  const strategies = approved
    ? await db.searchStrategy.findMany({ where: { orgId: auth.orgId, roleId: id }, orderBy: { version: "desc" }, take: 6, include: { runs: { orderBy: { createdAt: "desc" }, take: 5 } } })
    : [];
  const lastVersion = await db.searchStrategy.findFirst({ where: { roleId: id }, orderBy: { version: "desc" }, select: { version: true } });
  const allRuns = strategies.flatMap((st) => st.runs.map((r) => ({ ...r, strategyVersion: st.version }))).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  const currentRun = allRuns.find((r) => r.id === runParam) ?? allRuns.find((r) => r.status === "completed");
  const profiles = currentRun ? await db.sourcedProfile.findMany({ where: { orgId: auth.orgId, runId: currentRun.id } }) : [];
  const feedbackCounts = currentRun
    ? { useful: profiles.filter((p) => p.feedback === "useful").length, irrelevant: profiles.filter((p) => p.feedback === "irrelevant").length }
    : null;
  const profileView = (p: (typeof profiles)[number]): ProfileView => ({
    ...p,
    sourceLabel: sourceLabel(p.source),
    retrievedAt: p.retrievedAt.toISOString(),
    fields: JSON.parse(p.fieldsJson),
    signals: JSON.parse(p.signalsJson),
  });
  // Ordering by matched signals is a review aid, not an assessment. Limited/stale evidence is listed separately, unranked.
  const bySignals = (a: (typeof profiles)[number], b: (typeof profiles)[number]) => b.matchedSignals - a.matchedSignals || a.displayName.localeCompare(b.displayName);
  const groups = {
    review: profiles.filter((p) => p.status === "new" && p.evidenceStatus === "ok").sort(bySignals),
    limited: profiles.filter((p) => p.status === "new" && p.evidenceStatus !== "ok").sort(bySignals),
    saved: profiles.filter((p) => p.status === "saved"),
    dismissed: profiles.filter((p) => p.status === "dismissed"),
    excluded: profiles.filter((p) => p.status === "excluded"),
  };

  return (
    <>
      <PageHeader
        eyebrow={
          <>
            <Link href="/roles" className="hover:text-ink">Roles</Link> / <Link href={`/roles/${role.id}`} className="hover:text-ink">{role.title}</Link>
          </>
        }
        title="Sourcing"
        meta={<span>Approved criteria → Ideal Candidate Profile → search strategy → authorized sources → your review</span>}
      />

      <section className="mb-8" aria-labelledby="icp-h">
        <SectionTitle
          hint="Who to look for. Built from the approved criteria and JD; you review every item. Only an approved profile drives search."
          action={
            approvedCriteria > 0 && !draft ? <GenerateIcpButton roleId={role.id} aiConfigured={ai.configured} label={approved ? "Generate a new version" : "Generate profile"} /> : null
          }
        >
          <span id="icp-h">Ideal Candidate Profile</span>
        </SectionTitle>
        {approvedCriteria === 0 ? (
          <EmptyState title="Approve criteria first" body="The profile is built from the role's approved criteria." action={<Link href={`/roles/${role.id}?tab=criteria`} className="font-medium underline">Go to criteria</Link>} />
        ) : draft ? (
          <>
            <div className="mb-3 flex items-center gap-3 text-[12.5px] text-muted">
              <span>
                Draft v{draft.version} · {draft.generator.startsWith("ai:") ? `generated by AI (${draft.generator.split(":")[2]?.split("/")[0]})` : draft.generator.startsWith("revision") ? `revision of v${draft.generator.split("-v").pop()}` : "built from approved criteria (not AI)"}
              </span>
              <span className="ml-auto">
                <GenerateIcpButton roleId={role.id} aiConfigured={ai.configured} label="Regenerate draft" />
              </span>
            </div>
            <IcpDraftEditor icp={toView(draft)} roleCriteriaVersion={role.criteriaVersion} />
          </>
        ) : approved ? (
          <Card className="p-5">
            <IcpApprovedView icp={toView(approved)} roleCriteriaVersion={role.criteriaVersion} />
          </Card>
        ) : (
          <EmptyState title="No profile yet" body="Generate a draft from the approved criteria. You'll review and approve it before any search." />
        )}
      </section>

      {approved && (
        <section className="mb-8" aria-labelledby="search-h">
          <SectionTitle hint="Turn the approved profile (and your own words) into filters and a Boolean query. Saved searches are versioned and can be re-run.">
            <span id="search-h">Search</span>
          </SectionTitle>
          <StrategyPlanner roleId={role.id} nextVersion={(lastVersion?.version ?? 0) + 1} aiConfigured={ai.configured} />

          {strategies.length > 0 && (
            <div className="mt-4 space-y-3">
              {strategies.map((st, i) => {
                const f = JSON.parse(st.filtersJson) as SearchFilters;
                return (
                  <Card key={st.id} className="p-4">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="font-medium">
                          Search v{st.version}
                          {i === 0 && <span className="ml-2 text-[12px] font-normal text-muted">latest</span>}
                        </div>
                        <div className="text-[12px] text-muted">
                          {st.createdByName} · {st.createdAt.toLocaleDateString("en-US", { month: "short", day: "numeric" })} · from profile v{st.icpVersion} ·{" "}
                          {st.generator.startsWith("ai:") ? "AI-planned, recruiter-saved" : st.generator.startsWith("parser:") ? "built from profile (not AI)" : "recruiter"}
                        </div>
                        {st.request && <div className="mt-1 text-[12.5px] text-ink-2">“{st.request}”</div>}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {CONNECTORS.map((c) => (
                          <RunSearchButton key={c.key} strategyId={st.id} sourceKey={c.key} label={`Run on ${c.label}`} disabled={!c.configured()} />
                        ))}
                      </div>
                    </div>
                    <dl className="mt-3 grid gap-x-6 gap-y-1 text-[12.5px] sm:grid-cols-2">
                      {(Object.keys(FILTER_LABEL) as (keyof SearchFilters)[])
                        .filter((k) => f[k]?.length)
                        .map((k) => (
                          <div key={k} className="flex gap-2">
                            <dt className="shrink-0 text-muted">{FILTER_LABEL[k]}:</dt>
                            <dd className="text-ink-2">{f[k].join(", ")}</dd>
                          </div>
                        ))}
                    </dl>
                    <details className="mt-2 text-[12.5px]">
                      <summary className="cursor-pointer text-muted">Query per source</summary>
                      <div className="mt-2 space-y-2">
                        <div>
                          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">Generic Boolean</div>
                          <code className="block break-words rounded bg-sunken p-2 font-mono text-[12px]">{st.booleanQuery}</code>
                        </div>
                        {CONNECTORS.map((c) => (
                          <div key={c.key}>
                            <div className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">
                              {c.label}
                              {!c.configured() && " · not connected"}
                            </div>
                            {c.configured() && <code className="block break-words rounded bg-sunken p-2 font-mono text-[12px]">{c.renderQuery(f, st.booleanQuery)}</code>}
                            <p className="text-[11.5px] text-muted">{c.configured() ? c.syntaxNote : c.setupHint}</p>
                          </div>
                        ))}
                      </div>
                    </details>
                    {i === 0 && <ImportExportForm strategyId={st.id} version={st.version} />}
                    {st.runs.length > 0 && (
                      <ul className="mt-2 space-y-0.5 border-t border-line pt-2 text-[12px]">
                        {st.runs.map((r) => (
                          <li key={r.id} className="flex flex-wrap gap-x-2">
                            <Link href={`/roles/${role.id}/sourcing?run=${r.id}#results`} className={r.id === currentRun?.id ? "font-medium text-ink" : "text-muted hover:text-ink"}>
                              {r.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} · {sourceLabel(r.source)}
                            </Link>
                            <span className="text-faint">
                              {r.status === "completed"
                                ? `${r.resultCount} results${r.excludedCount ? ` · ${r.excludedCount} set aside by exclusions` : ""}${r.estimatedTotal != null ? ` · source estimate ${r.estimatedTotal}` : ""}`
                                : r.status === "setup_required"
                                  ? "source not connected"
                                  : "failed"}
                            </span>
                            {r.source === "file" && <span className="text-faint">· {r.query}</span>}
                          </li>
                        ))}
                      </ul>
                    )}
                  </Card>
                );
              })}
            </div>
          )}

          <div className="mt-4 rounded-xl border border-dashed border-line-strong p-4 text-[13px]">
            <div className="font-medium">Sources</div>
            <ul className="mt-1 space-y-1">
              {CONNECTORS.map((c) => (
                <li key={c.key}>
                  <span className={c.configured() ? "text-ok" : "text-faint"}>{c.configured() ? "● Connected" : "○ Not connected"}</span> <span className="font-medium">{c.label}</span>{" "}
                  <span className="text-muted">— {c.configured() ? c.description : c.setupHint}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>
      )}

      {currentRun && (
        <section id="results" className="scroll-mt-6" aria-labelledby="results-h">
          <SectionTitle
            hint={`Search v${currentRun.strategyVersion} on ${sourceLabel(currentRun.source)} · ${currentRun.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${feedbackCounts ? ` · ${feedbackCounts.useful} marked useful, ${feedbackCounts.irrelevant} not relevant` : ""}`}
          >
            <span id="results-h">Results to review</span>
          </SectionTitle>
          <nav className="mb-3 flex flex-wrap gap-1 text-[13px]" aria-label="Result filters">
            {(
              [
                ["review", `To review ${groups.review.length}`],
                ["limited", `Limited evidence ${groups.limited.length}`],
                ["saved", `Saved ${groups.saved.length}`],
                ["dismissed", `Dismissed ${groups.dismissed.length}`],
                ["excluded", `Set aside by exclusions ${groups.excluded.length}`],
              ] as const
            ).map(([k, label]) => (
              <Link
                key={k}
                href={`/roles/${role.id}/sourcing?run=${currentRun.id}&view=${k}#results`}
                className={view === k ? "rounded-lg bg-ink px-2.5 py-1 font-medium text-white" : "rounded-lg px-2.5 py-1 text-muted hover:bg-sunken hover:text-ink"}
              >
                {label}
              </Link>
            ))}
          </nav>
          <p className="mb-2 text-[12px] text-faint">
            {view === "limited"
              ? "No current CV or an old one: shown unranked rather than forcing a precise order."
              : "Ordered by matched profile signals with quoted evidence — a review aid, not an assessment. Save a profile to assess it against the approved criteria."}
          </p>
          {groups[view as keyof typeof groups]?.length ? (
            <Card className="divide-y divide-line overflow-hidden">
              {groups[view as keyof typeof groups].map((p) => (
                <ResultRow key={p.id} p={profileView(p)} />
              ))}
            </Card>
          ) : (
            <EmptyState title="Nothing here" body={view === "review" ? "No profiles from this run are waiting for review." : undefined} />
          )}
        </section>
      )}
    </>
  );
}
