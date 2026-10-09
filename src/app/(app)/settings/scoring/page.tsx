import { Badge, Breadcrumbs, Card, EmptyState, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { MIN_GROUP, MIN_N, scoringMonitor } from "@/lib/scoring-monitor";
import { AccommodationForm, DemographicImport, FlagReview, MonitoringToggle } from "./forms";

export const metadata = { title: "Scoring validation & fairness" };

const pct = (n: number, d: number) => (d >= MIN_N ? `${Math.round((n / d) * 100)}%` : null);
function Rate({ n, d }: { n: number; d: number }) {
  const r = pct(n, d);
  return r ? (
    <span className="tabular-nums">
      {r} <span className="text-faint">({n}/{d})</span>
    </span>
  ) : (
    <span className="text-faint">Insufficient data ({n}/{d})</span>
  );
}

/** Admin-only: validation and fairness monitoring of role scoring, by role and scoring version. */
export default async function ScoringMonitorPage() {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin")
    return <EmptyState title="Admins only" body="Scoring validation and fairness monitoring is limited to workspace admins." />;
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { accommodationText: true, demographicMonitoring: true, demographicAttestedBy: true, demographicAttestedAt: true } });
  const [data, demoCount] = await Promise.all([scoringMonitor(auth.orgId, { demographics: org.demographicMonitoring }), db.demographicRecord.count({ where: { orgId: auth.orgId } })]);
  const th = "px-3 py-1.5 font-medium";
  const td = "px-3 py-1.5";

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader eyebrow={<Breadcrumbs items={[{ label: "Workspace settings", href: "/settings" }, { label: "Scoring validation & fairness" }]} />} title="Scoring validation & fairness" />
      <Card className="border-warn/40 p-4 text-[13px] text-ink-2">
        These are descriptive statistics for review. They can&apos;t show that scoring is unbiased, valid or legally compliant — editable thresholds don&apos;t make it so either. Your
        organisation must assess this process under the laws that apply to its locations and use. Historical decisions are shown as outcomes to examine, not as ground truth; past decisions may
        contain bias. Rates need {MIN_N}+ in the denominator; demographic groups under {MIN_GROUP} are suppressed.
      </Card>

      {data.length === 0 ? (
        <EmptyState title="No scored candidates yet" body="Each role gets a scoring version when its first candidate is scored." />
      ) : (
        data.map((d) => (
          <section key={d.version.id} aria-label={`${d.version.role.title} v${d.version.version}`}>
            <SectionTitle hint={`Created ${formatDate(d.version.createdAt)} by ${d.version.createdByName} · weights ${d.version.weightRequired}/${d.version.weightPreferred} · min coverage ${Math.round(d.version.minCoverage * 100)}%`}>
              <span className="flex flex-wrap items-center gap-2">
                {d.version.role.title} · scoring v{d.version.version}
                {d.version.flaggedAt && !d.version.flagReviewedAt && <Badge tone="warn">Flagged for review</Badge>}
                {d.version.flagReviewedAt && <Badge>Flag reviewed</Badge>}
              </span>
            </SectionTitle>
            <Card className="space-y-4 p-4 text-[13px]">
              {d.version.flaggedAt && (
                <div className="rounded-lg border border-warn/40 bg-warn-soft/40 p-3">
                  <div className="font-medium">Flagged {formatDate(d.version.flaggedAt)}: {d.version.flagReason}</div>
                  {d.version.flagReviewedAt ? (
                    <p className="mt-1 text-ink-2">
                      Reviewed by {d.version.flagReviewedBy} on {formatDate(d.version.flagReviewedAt)}: {d.version.flagNote}
                    </p>
                  ) : (
                    <FlagReview versionId={d.version.id} />
                  )}
                </div>
              )}
              <div className="grid gap-3 sm:grid-cols-4">
                <div>
                  <div className="text-[12px] text-muted">Candidates scored</div>
                  <div className="font-semibold tabular-nums">{d.n}</div>
                </div>
                <div>
                  <div className="text-[12px] text-muted">Insufficient evidence</div>
                  <Rate n={d.insufficient} d={d.n} />
                </div>
                <div>
                  <div className="text-[12px] text-muted">Alternative route</div>
                  <span className="tabular-nums">{d.alternative}</span>
                </div>
                <div>
                  <div className="text-[12px] text-muted">Results corrected by recruiters</div>
                  <Rate n={d.corr} d={d.items} />
                </div>
              </div>

              <div>
                <div className="mb-1 font-medium">Score distribution ({d.ok} with a score)</div>
                <div className="flex items-end gap-1" role="img" aria-label={d.buckets.map((b) => `${b.from}–${b.from + 9}: ${b.n}`).join(", ")}>
                  {d.buckets.map((b) => {
                    const max = Math.max(1, ...d.buckets.map((x) => x.n));
                    return (
                      <div key={b.from} className="flex flex-1 flex-col items-center gap-0.5">
                        <span className="text-[10.5px] tabular-nums text-muted">{b.n || ""}</span>
                        <span className="w-full rounded-sm bg-ink-2/70" style={{ height: `${Math.max(2, (b.n / max) * 56)}px` }} />
                        <span className="text-[10.5px] tabular-nums text-faint">{b.from}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="overflow-x-auto">
                <div className="mb-1 font-medium">Do higher bands go with documented outcomes?</div>
                <table className="w-full">
                  <thead className="bg-sunken text-left text-muted">
                    <tr>
                      <th className={th}>Band (recommendation)</th>
                      <th className={th}>n</th>
                      <th className={th}>Shortlisted</th>
                      <th className={th}>Interviewed</th>
                      <th className={th}>Hired</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {d.byBand.map((b) => (
                      <tr key={b.key}>
                        <td className={td}>{b.label}</td>
                        <td className={`${td} tabular-nums`}>{b.n}</td>
                        <td className={td}>
                          <Rate n={b.shortlisted} d={b.n} />
                        </td>
                        <td className={td}>
                          <Rate n={b.interviewed} d={b.n} />
                        </td>
                        <td className={td}>
                          <Rate n={b.hired} d={b.n} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <p className="mt-1 text-[12px] text-muted">
                  {d.monotonic === null
                    ? `Not enough data in every band to compare (each band needs ${MIN_N}+).`
                    : d.monotonic
                      ? "Shortlist rates rise with the band. This is an association with recruiter decisions, not proof of validity."
                      : "Shortlist rates do not rise with the band — review whether the criteria and weights reflect the role."}
                </p>
              </div>

              {org.demographicMonitoring && (
                <div>
                  <div className="mb-1 font-medium">Outcomes across self-reported groups</div>
                  {d.groups.length === 0 ? (
                    <p className="text-muted">No self-reported responses for candidates scored with this version.</p>
                  ) : (
                    d.groups.map((g) => {
                      const shown = g.rows.filter((r) => !r.suppressed);
                      const hidden = g.rows.length - shown.length;
                      return (
                        <div key={g.category} className="mb-3 overflow-x-auto">
                          <table className="w-full">
                            <thead className="bg-sunken text-left text-muted">
                              <tr>
                                <th className={th}>{g.category}</th>
                                <th className={th}>n</th>
                                <th className={th}>AI Screen Pass rate</th>
                                <th className={th}>Shortlist rate</th>
                                <th className={th}>Correction rate</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-line">
                              {shown.map((r) => (
                                <tr key={r.value}>
                                  <td className={td}>{r.value}</td>
                                  <td className={`${td} tabular-nums`}>{r.n}</td>
                                  <td className={td}>{r.passRate === null ? "—" : `${Math.round(r.passRate * 100)}%`}</td>
                                  <td className={td}>{r.shortRate === null ? "—" : `${Math.round(r.shortRate * 100)}%`}</td>
                                  <td className={td}>{r.corrRate === null ? "—" : `${Math.round(r.corrRate * 100)}%`}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <p className="mt-1 text-[12px] text-muted">
                            {hidden ? `${hidden} group${hidden === 1 ? "" : "s"} under ${MIN_GROUP} suppressed. ` : ""}
                            {shown.length < 2 ? "Insufficient data: fewer than two groups large enough to compare. " : ""}
                            {g.flags.length ? `Flagged: ${g.flags.join("; ")}.` : shown.length >= 2 ? "No difference above the review thresholds — this doesn't establish fairness." : ""}
                          </p>
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </Card>
          </section>
        ))
      )}

      <section>
        <SectionTitle hint="Shown to recruiters next to the alternative-assessment control. Share it in job ads and outreach — Talyn has no candidate-facing portal.">
          Alternative assessment instructions
        </SectionTitle>
        <Card className="p-4">
          <AccommodationForm value={org.accommodationText} />
        </Card>
      </section>

      <section>
        <SectionTitle hint="Self-reported only, stored separately from candidate records, never shown in candidate or recruiter views, never inferred from names, photos or other data.">
          Demographic monitoring data
        </SectionTitle>
        <Card className="space-y-3 p-4 text-[13px]">
          <p>
            Status: <strong>{org.demographicMonitoring ? "On" : "Off"}</strong>
            {org.demographicMonitoring && org.demographicAttestedBy ? ` — attested by ${org.demographicAttestedBy} on ${formatDate(org.demographicAttestedAt!)}` : ""} · {demoCount} stored responses
          </p>
          <MonitoringToggle enabled={org.demographicMonitoring} />
          {org.demographicMonitoring && <DemographicImport count={demoCount} />}
          {!org.demographicMonitoring && demoCount > 0 && <DemographicImport count={demoCount} />}
        </Card>
      </section>
    </div>
  );
}
