import Link from "next/link";
import { Badge, Card, LinkButton, SectionTitle, formatDateTime } from "@/components/ui";
import type { StatusItem } from "@/components/status-line";
import { AUDIT_LABEL } from "@/lib/audit";
import { db } from "@/lib/db";
import { THRESHOLD_LABEL, type RoleSkillConfig, type SkillMatch } from "@/lib/skills";

type Crit = { id: string; name: string; importance: string; status: string; kind: string };
type SkillSummary = { config: RoleSkillConfig; matches: { match: SkillMatch; isSample: boolean; origin: string }[] };

/**
 * Role overview: what this role is looking for, the next work on it, who's involved, and what
 * changed recently. Every line comes from stored records; there are no totals for decoration.
 */
export async function RoleOverview({
  orgId,
  role,
  criteria,
  next,
  skills,
}: {
  orgId: string;
  role: { id: string; createdById: string | null; createdAt: Date };
  criteria: Crit[];
  next: StatusItem[];
  skills: SkillSummary;
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

  const approved = criteria.filter((c) => c.status === "approved" && c.kind !== "skill");
  const approvedSkills = criteria.filter((c) => c.status === "approved" && c.kind === "skill");
  const proposed = criteria.filter((c) => c.status === "proposed");
  // Skill-matching summary from real (non-sample) candidates only.
  const real = skills.matches.filter((m) => !m.isSample);
  const sampleCount = skills.matches.length - real.length;
  const assessedCurrent = real.filter((m) => m.match.evidenced !== null && !m.match.stale).length;
  const byState = (st: string) => real.filter((m) => m.match.state === st).length;
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

        <section aria-labelledby="skillsum-h">
          <SectionTitle
            hint="Evidence-based matches against the recruiter-set skill threshold — not hiring decisions. No one is hidden, rejected or advanced by them."
            action={<LinkButton href={`/roles/${role.id}?tab=criteria#rubric`} size="sm">Edit skills & threshold</LinkButton>}
          >
            <span id="skillsum-h">Skill matching</span>
          </SectionTitle>
          <Card className="p-4 text-[13.5px]">
            {skills.config.requiredSkillIds.length === 0 ? (
              <p className="text-muted">
                No required skills approved yet.{" "}
                <Link href={`/roles/${role.id}?tab=criteria`} className="font-medium text-brand hover:underline">
                  Add skills
                </Link>
              </p>
            ) : (
              <div className="space-y-2">
                <p>
                  {skills.config.threshold != null ? (
                    <>
                      Threshold: at least <strong>{skills.config.threshold}</strong> of {skills.config.requiredSkillIds.length} required skills with evidence found
                      {skills.config.partialCredit ? " (partial evidence counts)" : ""}.
                    </>
                  ) : (
                    <>No minimum set — counts are shown without a threshold.</>
                  )}{" "}
                  {skills.config.preferredSkillIds.length > 0 && <span className="text-muted">{skills.config.preferredSkillIds.length} preferred skill{skills.config.preferredSkillIds.length === 1 ? "" : "s"} shown separately.</span>}
                </p>
                {real.length === 0 ? (
                  <p className="text-muted">No real candidates in this role yet{sampleCount ? ` (${sampleCount} fictional sample ${sampleCount === 1 ? "person is" : "people are"} excluded)` : ""}.</p>
                ) : (
                  <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-4">
                    <div>
                      <dt className="text-[12px] text-muted">Assessed and current</dt>
                      <dd className="font-semibold tabular-nums">
                        {assessedCurrent} <span className="font-normal text-muted">of {real.length}</span>
                      </dd>
                    </div>
                    {skills.config.threshold != null && (
                      <>
                        <div>
                          <dt className="text-[12px] text-muted">{THRESHOLD_LABEL.meets}</dt>
                          <dd className="font-semibold tabular-nums">
                            {byState("meets")}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-[12px] text-muted">{THRESHOLD_LABEL.below}</dt>
                          <dd className="font-semibold tabular-nums">
                            {byState("below")}
                          </dd>
                        </div>
                      </>
                    )}
                    <div>
                      <dt className="text-[12px] text-muted">Needs review or not assessed</dt>
                      <dd className="font-semibold tabular-nums">{byState("needs_review") + byState("not_assessed")}</dd>
                    </div>
                  </dl>
                )}
                <p className="text-[12px] text-faint">
                  Counts cover applied and discovered candidates who aren&apos;t rejected{sampleCount ? `; ${sampleCount} fictional sample ${sampleCount === 1 ? "person is" : "people are"} excluded` : ""}. Filters on Applicants
                  and Shortlist use the same statuses.
                </p>
              </div>
            )}
          </Card>
        </section>

        <section aria-labelledby="crit-h">
          <SectionTitle
            hint="What applicants and discovered people are compared against. Proposed criteria aren't used until approved."
            action={<LinkButton href={`/roles/${role.id}?tab=criteria`} size="sm">Edit criteria</LinkButton>}
          >
            <span id="crit-h">Skills and criteria</span>
          </SectionTitle>
          {approved.length === 0 && approvedSkills.length === 0 ? (
            <Card className="px-4 py-3 text-[13.5px] text-muted">
              No approved skills or criteria yet{proposed.length ? ` — ${proposed.length} proposed and waiting for review` : ""}.{" "}
              <Link href={`/roles/${role.id}?tab=criteria`} className="font-medium text-brand hover:underline">
                {proposed.length ? "Review proposals" : "Set up criteria"}
              </Link>
            </Card>
          ) : (
            <Card className="grid gap-4 p-4 sm:grid-cols-2">
              {(
                [
                  ["Required skills", approvedSkills.filter((c) => c.importance !== "preferred")],
                  ["Preferred skills", approvedSkills.filter((c) => c.importance === "preferred")],
                  ["Required criteria", approved.filter((c) => c.importance === "essential")],
                  ["Preferred & informational criteria", approved.filter((c) => c.importance !== "essential")],
                ] as const
              ).map(([label, list]) => {
                return (
                  <div key={label}>
                    <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">{label}</div>
                    {list.length ? (
                      <ul className="space-y-1 text-[13.5px]">
                        {list.map((c) => (
                          <li key={c.id} className="flex gap-2">
                            <span aria-hidden className="text-faint">–</span>
                            {c.name}
                            {c.importance === "informational" && <span className="text-[12px] text-muted">(informational)</span>}
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
