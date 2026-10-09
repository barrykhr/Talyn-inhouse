import Link from "next/link";
import { Badge, Card, LinkButton, SectionTitle, formatDateTime } from "@/components/ui";
import type { StatusItem } from "@/components/status-line";
import { AUDIT_LABEL } from "@/lib/audit";
import { db } from "@/lib/db";

type Crit = { id: string; name: string; importance: string; status: string };

/**
 * Role overview: what this role is looking for, the next work on it, who's involved, and what
 * changed recently. Every line comes from stored records; there are no totals for decoration.
 */
export async function RoleOverview({
  orgId,
  role,
  criteria,
  next,
}: {
  orgId: string;
  role: { id: string; createdById: string | null; createdAt: Date };
  criteria: Crit[];
  next: StatusItem[];
}) {
  const [owner, kits, activity, discoverToReview, unscheduled] = await Promise.all([
    role.createdById ? db.user.findUnique({ where: { id: role.createdById }, select: { name: true } }) : null,
    db.interviewKit.findMany({
      where: { orgId, roleId: role.id },
      select: { id: true, ownerName: true, decision: true, stages: { select: { assignments: { select: { interviewerName: true, status: true } } } } },
    }),
    db.auditEvent.findMany({ where: { orgId, roleId: role.id, action: { not: "candidate.viewed" } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, actorName: true, action: true, createdAt: true } }),
    db.sourcedProfile.count({ where: { orgId, roleId: role.id, status: "new" } }),
    db.interviewStage.count({ where: { kit: { orgId, roleId: role.id, status: "shared" }, scheduledAt: null, assignments: { some: {} }, events: { none: { status: "scheduled" } } } }),
  ]);

  const approved = criteria.filter((c) => c.status === "approved");
  const proposed = criteria.filter((c) => c.status === "proposed");
  const work: StatusItem[] = [...next];
  if (discoverToReview) work.push({ tone: "attention", text: `${discoverToReview} discovery result${discoverToReview === 1 ? "" : "s"} to save or dismiss`, href: `/roles/${role.id}/discover#results`, action: "Review" });
  if (unscheduled) work.push({ tone: "attention", text: `${unscheduled} interview stage${unscheduled === 1 ? "" : "s"} not scheduled`, href: `/roles/${role.id}/interviews`, action: "Schedule" });
  const pendingCards = kits.flatMap((k) => k.stages.flatMap((s) => s.assignments)).filter((a) => a.status !== "submitted").length;
  if (pendingCards) work.push({ tone: "neutral", text: `${pendingCards} scorecard${pendingCards === 1 ? "" : "s"} not yet submitted`, href: `/roles/${role.id}/interviews`, action: "Open" });

  const interviewers = [...new Set(kits.flatMap((k) => k.stages.flatMap((s) => s.assignments.map((a) => a.interviewerName))))];
  const collaborators = [...new Set(activity.map((a) => a.actorName).filter((n) => n && n !== owner?.name))];

  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_300px]">
      <div className="min-w-0 space-y-5">
        <section aria-labelledby="next-h">
          <SectionTitle hint="Taken from this role's records. Each item opens the screen where it happens.">
            <span id="next-h">Next work</span>
          </SectionTitle>
          {work.length ? (
            <Card className="divide-y divide-line overflow-hidden">
              {work.map((w, i) => (
                <div key={i} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-[13.5px]">
                  <span className="flex items-center gap-2">
                    <Badge tone={w.tone === "attention" ? "warn" : w.tone === "ai" ? "brand" : w.tone === "ok" ? "ok" : "neutral"}>
                      {w.tone === "attention" ? "Needs a person" : w.tone === "ai" ? "AI proposal" : w.tone === "ok" ? "Up to date" : "To do"}
                    </Badge>
                    {w.text}
                  </span>
                  {w.href && (
                    <Link href={w.href} className="text-[13px] font-medium text-brand hover:underline">
                      {w.action ?? "Open"} →
                    </Link>
                  )}
                </div>
              ))}
            </Card>
          ) : (
            <Card className="px-4 py-3 text-[13.5px] text-muted">Nothing is waiting on a person for this role right now.</Card>
          )}
        </section>

        <section aria-labelledby="crit-h">
          <SectionTitle
            hint="What applicants and discovered people are compared against. Proposed criteria aren't used until approved."
            action={<LinkButton href={`/roles/${role.id}?tab=criteria`} size="sm">Edit criteria</LinkButton>}
          >
            <span id="crit-h">Criteria</span>
          </SectionTitle>
          {approved.length === 0 ? (
            <Card className="px-4 py-3 text-[13.5px] text-muted">
              No approved criteria yet{proposed.length ? ` — ${proposed.length} proposed and waiting for review` : ""}.{" "}
              <Link href={`/roles/${role.id}?tab=criteria`} className="font-medium text-brand hover:underline">
                {proposed.length ? "Review proposals" : "Set up criteria"}
              </Link>
            </Card>
          ) : (
            <Card className="grid gap-4 p-4 sm:grid-cols-2">
              {(["essential", "preferred"] as const).map((imp) => {
                const list = approved.filter((c) => c.importance === imp);
                return (
                  <div key={imp}>
                    <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{imp === "essential" ? "Essential" : "Preferred"}</div>
                    {list.length ? (
                      <ul className="space-y-1 text-[13.5px]">
                        {list.map((c) => (
                          <li key={c.id} className="flex gap-2">
                            <span aria-hidden className="text-faint">–</span>
                            {c.name}
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <p className="text-[13px] text-faint">None</p>
                    )}
                  </div>
                );
              })}
              {proposed.length > 0 && <p className="text-[12.5px] text-muted sm:col-span-2">Plus {proposed.length} proposed, not yet in use.</p>}
            </Card>
          )}
        </section>

        <section aria-labelledby="act-h">
          <SectionTitle hint="Who changed what on this role. AI runs are listed under the person who started them.">
            <span id="act-h">Recent activity</span>
          </SectionTitle>
          {activity.length ? (
            <Card className="divide-y divide-line overflow-hidden">
              {activity.map((e) => (
                <div key={e.id} className="flex flex-wrap items-center gap-x-2 px-4 py-2 text-[13px]">
                  <span className="font-medium">{e.actorName || "Talyn"}</span>
                  <span className="text-ink-2">{(AUDIT_LABEL[e.action] ?? e.action).toLowerCase()}</span>
                  <span className="ml-auto text-[12px] text-faint">{formatDateTime(e.createdAt)}</span>
                </div>
              ))}
            </Card>
          ) : (
            <Card className="px-4 py-3 text-[13.5px] text-muted">No activity recorded on this role yet.</Card>
          )}
        </section>
      </div>

      <aside className="space-y-4" aria-label="People on this role">
        <Card className="p-4 text-[13px]">
          <h2 className="mb-2 text-[13px] font-semibold">People on this role</h2>
          <dl className="space-y-2.5">
            <div>
              <dt className="text-[12px] text-muted">Owner</dt>
              <dd>{owner?.name ?? <span className="text-faint">Not recorded</span>}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Collaborators</dt>
              <dd>{collaborators.length ? collaborators.join(", ") : <span className="text-faint">No one else has worked on this role yet</span>}</dd>
            </div>
            <div>
              <dt className="text-[12px] text-muted">Interviewers</dt>
              <dd>{interviewers.length ? interviewers.join(", ") : <span className="text-faint">None assigned</span>}</dd>
            </div>
          </dl>
          <Link href="/settings#team" className="mt-3 inline-block text-[12.5px] text-muted hover:text-ink">
            Manage team & permissions
          </Link>
        </Card>
        <Card className="p-4 text-[12.5px] text-muted">
          Created {formatDateTime(role.createdAt)}. Talyn&apos;s assistant prepares searches, evidence and drafts; shortlisting, rejecting, outreach and interview decisions are always made by a person.
        </Card>
      </aside>
    </div>
  );
}
