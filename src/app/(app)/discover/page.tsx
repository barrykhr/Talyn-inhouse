import Link from "next/link";
import { RoleStatusBadge } from "@/components/status";
import { Badge, Card, EmptyState, LinkButton, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CONNECTORS, isLiveSourceConnected, sourceLabel } from "@/lib/sourcing/connectors";

export const metadata = { title: "Discover" };

/** Discover home: sources this workspace can use, and every role's search at a glance. */
export default async function DiscoverHome() {
  const auth = await requireAuth();
  const roles = await db.role.findMany({
    where: { orgId: auth.orgId, status: { not: "closed" } },
    orderBy: { updatedAt: "desc" },
    take: 100,
    select: {
      id: true,
      title: true,
      status: true,
      location: true,
      discoveryBrief: { select: { confirmedAt: true, origin: true, updatedAt: true } },
    },
  });
  const ids = roles.map((r) => r.id);
  const [runs, toReview, saved] = await Promise.all([
    db.searchRun.findMany({ where: { orgId: auth.orgId, roleId: { in: ids } }, orderBy: { createdAt: "desc" }, select: { roleId: true, createdAt: true, source: true, isDemo: true, status: true, resultCount: true } }),
    db.sourcedProfile.groupBy({ by: ["roleId"], where: { orgId: auth.orgId, roleId: { in: ids }, status: "new" }, _count: true }),
    db.application.groupBy({ by: ["roleId"], where: { orgId: auth.orgId, roleId: { in: ids }, origin: "discovered" }, _count: true }),
  ]);
  const lastRun = new Map<string, (typeof runs)[number]>();
  for (const r of runs) if (!lastRun.has(r.roleId)) lastRun.set(r.roleId, r);
  const count = (xs: { roleId: string; _count: number }[], id: string) => xs.find((x) => x.roleId === id)?._count ?? 0;
  const live = isLiveSourceConnected();
  const active = roles.filter((r) => r.discoveryBrief || lastRun.has(r.id));
  const others = roles.filter((r) => !r.discoveryBrief && !lastRun.has(r.id));

  return (
    <div className="space-y-6">
      <PageHeader
        title="Discover"
        meta={<span>Find people for a role from sources your workspace is connected to. Separate from applicants; nothing is sent or decided automatically.</span>}
        actions={
          <LinkButton href="/discover/new" variant="primary">
            New search
          </LinkButton>
        }
      />

      <Card className="p-4">
        <SectionTitle hint="Only connected sources can be searched. Demo mode uses fictional sample people and is never shown as a live search.">Sources</SectionTitle>
        <ul className="grid gap-2 text-[13px] sm:grid-cols-3">
          {CONNECTORS.map((c) => (
            <li key={c.key} className="rounded-lg border border-line p-2.5">
              <div className="flex items-center justify-between gap-2 font-medium">
                {c.label}
                {c.kind === "sample" ? (
                  <Badge tone={c.configured() ? "warn" : "neutral"}>{c.configured() ? "Demo available" : "Off"}</Badge>
                ) : (
                  <Badge tone={c.configured() ? "ok" : "neutral"}>{c.configured() ? "Connected" : "Not connected"}</Badge>
                )}
              </div>
              <p className="mt-0.5 text-[12px] text-muted">{c.configured() ? c.description : c.setupHint.split(". ").slice(0, 2).join(". ") + "."}</p>
              {!c.configured() && c.kind === "external" && (
                <Link href="/settings/integrations" className="mt-1 inline-block text-[12px] font-medium underline">
                  Set up
                </Link>
              )}
            </li>
          ))}
        </ul>
        {!live && <p className="mt-2 text-[12px] text-warn">No external talent provider is connected, so live searches cover your existing Talyn candidates only.</p>}
      </Card>

      <section aria-labelledby="searches-h">
        <SectionTitle>
          <span id="searches-h">Searches by role</span>
        </SectionTitle>
        {roles.length === 0 ? (
          <EmptyState title="No roles yet" body="Start a search from a job description or by entering the role details." action={<LinkButton href="/discover/new" variant="primary">New search</LinkButton>} />
        ) : (
          <Card className="divide-y divide-line overflow-hidden">
            {[...active, ...others].map((r) => {
              const run = lastRun.get(r.id);
              const pending = count(toReview, r.id);
              return (
                <Link key={r.id} href={`/roles/${r.id}/discover`} className="grid gap-x-4 gap-y-1 px-4 py-3 hover:bg-sunken/50 md:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto] md:items-center">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2 font-medium">
                      {r.title} <RoleStatusBadge status={r.status} />
                    </div>
                    {r.location && <div className="text-[12.5px] text-muted">{r.location}</div>}
                  </div>
                  <div className="text-[12.5px]">
                    {!r.discoveryBrief ? (
                      <span className="text-faint">Search fields not set up</span>
                    ) : r.discoveryBrief.confirmedAt ? (
                      <span className="text-ink-2">Fields confirmed {formatDate(r.discoveryBrief.confirmedAt)}</span>
                    ) : (
                      <span className="text-warn">Suggested fields to review</span>
                    )}
                  </div>
                  <div className="text-[12.5px] text-muted">
                    {run ? (
                      <>
                        Last search {formatDate(run.createdAt)} · {run.source.split("+").map(sourceLabel).join(", ")}
                        {run.isDemo && <Badge tone="warn" className="ml-1.5">Demo</Badge>}
                        {run.status === "failed" && <span className="text-danger"> · failed</span>}
                      </>
                    ) : (
                      "No searches yet"
                    )}
                  </div>
                  <div className="flex gap-3 text-[12.5px] md:justify-end">
                    {pending > 0 && <span className="font-medium text-signal">{pending} to review</span>}
                    <span className="text-muted">{count(saved, r.id)} saved</span>
                  </div>
                </Link>
              );
            })}
          </Card>
        )}
      </section>
    </div>
  );
}
