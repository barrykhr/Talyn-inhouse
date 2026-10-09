import clsx from "clsx";
import Link from "next/link";
import { Breadcrumbs, Card, EmptyState, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { MIN_SAMPLE, calibration, rate } from "@/lib/calibration";

export const metadata = { title: "Calibration" };

const PERIODS = [30, 90, 365] as const;

function Rate({ n, d }: { n: number; d: number }) {
  const r = rate(n, d);
  return r ? (
    <span className="tabular-nums">
      {r} <span className="text-faint">({n}/{d})</span>
    </span>
  ) : (
    <span className="text-faint" title={`Fewer than ${MIN_SAMPLE} in the denominator`}>
      Insufficient data ({n}/{d})
    </span>
  );
}

/** Manager calibration: where recruiters corrected assessments, which evidence they overruled, and outcomes by band. */
export default async function CalibrationPage({ searchParams }: { searchParams: Promise<{ days?: string }> }) {
  const auth = await requireAuth();
  const { days: d } = await searchParams;
  const days = (PERIODS as readonly number[]).includes(Number(d)) ? Number(d) : 90;
  const c = await calibration(auth.orgId, days);
  const th = "px-3 py-1.5 font-medium";
  const td = "px-3 py-1.5";

  return (
    <div className="max-w-5xl space-y-6">
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Workspace settings", href: "/settings" }, { label: "Calibration" }]} />}
        title="Calibration"
        meta={
          <span>
            {formatDate(c.since)} – today · {c.itemsTotal} assessed skill/criterion results · {c.correctionsTotal} recruiter corrections · {c.applications} candidate–role pairs (fictional samples excluded)
          </span>
        }
        actions={
          <nav className="flex gap-1 text-[13px]" aria-label="Period">
            {PERIODS.map((p) => (
              <Link key={p} href={`/settings/calibration?days=${p}`} aria-current={p === days ? "page" : undefined} className={clsx("rounded-lg px-2.5 py-1 font-medium", p === days ? "bg-ink text-white" : "text-muted hover:bg-sunken hover:text-ink")}>
                {p === 365 ? "12 months" : `${p} days`}
              </Link>
            ))}
          </nav>
        }
      />
      <p className="-mt-3 text-[13px] text-muted">
        Built only from what was recorded: recruiter corrections, decisions and interview scorecards. These are descriptive counts — they don&apos;t show cause, and Talyn does not change how it
        assesses based on them. Rates need at least {MIN_SAMPLE} in the denominator.
      </p>

      {c.itemsTotal === 0 ? (
        <EmptyState title="No assessments in this period" body="Calibration appears once candidates have been assessed and reviewed." />
      ) : (
        <>
          <section>
            <SectionTitle hint="Per skill or criterion, across all roles in the period. Correction rate = results a recruiter corrected ÷ results produced.">Most corrected, and most often short of evidence</SectionTitle>
            <Card className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-sunken text-left text-muted">
                  <tr>
                    <th className={th}>Skill / criterion</th>
                    <th className={clsx(th, "text-right")}>Results</th>
                    <th className={th}>Corrected by a recruiter</th>
                    <th className={th}>Not enough evidence</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {c.criteria.map((r) => (
                    <tr key={`${r.kind}${r.name}`}>
                      <td className={td}>
                        {r.name} <span className="text-[11.5px] text-faint">{r.kind === "skill" ? "skill" : "criterion"}</span>
                      </td>
                      <td className={clsx(td, "text-right tabular-nums")}>{r.total}</td>
                      <td className={td}>
                        <Rate n={r.corrected} d={r.total} />
                      </td>
                      <td className={td}>
                        <Rate n={r.notEnough} d={r.total} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
            <p className="mt-1 text-[12px] text-faint">“Not enough evidence” = not stated, inferred or partial (after corrections). It is missing evidence, not proof a candidate lacks something.</p>
          </section>

          <section>
            <SectionTitle hint="Overruled = the assessment found evidence and a recruiter corrected it to none, conflicting or not present. Missed = it found none and a recruiter found support.">
              Evidence recruiters overruled, by source
            </SectionTitle>
            <Card className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead className="bg-sunken text-left text-muted">
                  <tr>
                    <th className={th}>Evidence type · produced by</th>
                    <th className={clsx(th, "text-right")}>Results</th>
                    <th className={th}>Overruled (misleading)</th>
                    <th className={th}>Missed (insufficient)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {c.evidence.map((r) => (
                    <tr key={r.label}>
                      <td className={td}>{r.label}</td>
                      <td className={clsx(td, "text-right tabular-nums")}>{r.checked}</td>
                      <td className={td}>
                        <Rate n={r.overruled} d={r.checked} />
                      </td>
                      <td className={td}>
                        <Rate n={r.missed} d={r.checked} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          </section>

          <section>
            <SectionTitle hint="Latest assessment per candidate–role pair in the period. Shortlisted = recruiter decision Shortlist; interviewed = an interview plan was shared. Association only — the band doesn't cause the outcome.">
              Shortlist and interview rates by assessment band
            </SectionTitle>
            <div className="grid gap-3 md:grid-cols-2">
              {(
                [
                  ["Required-skill threshold", c.skillBands],
                  ["Evaluation-criteria alignment", c.alignBands],
                ] as const
              ).map(([title, bands]) => (
                <Card key={title} className="overflow-x-auto">
                  <div className="border-b border-line px-3 py-2 text-[12.5px] font-semibold">{title}</div>
                  {bands.length === 0 ? (
                    <p className="px-3 py-2 text-[12.5px] text-muted">No data in this period.</p>
                  ) : (
                    <table className="w-full text-[13px]">
                      <thead className="text-left text-muted">
                        <tr>
                          <th className={th}>Band</th>
                          <th className={clsx(th, "text-right")}>n</th>
                          <th className={th}>Shortlisted</th>
                          <th className={th}>Interviewed</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-line">
                        {bands.map((b) => (
                          <tr key={b.label}>
                            <td className={td}>{b.label}</td>
                            <td className={clsx(td, "text-right tabular-nums")}>{b.n}</td>
                            <td className={td}>
                              <Rate n={b.shortlisted} d={b.n} />
                            </td>
                            <td className={td}>
                              <Rate n={b.interviewed} d={b.n} />
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                </Card>
              ))}
            </div>
          </section>

          <section>
            <SectionTitle hint="Candidates whose assessment was reassessed or corrected after their first interview scorecard was submitted.">
              Assessments that changed after interview evidence
            </SectionTitle>
            <Card className="p-4 text-[13px]">
              <p className="mb-2">
                <Rate n={c.afterInterview.length} d={c.withInterviewEvidence} /> of candidates with submitted scorecards in this period.
              </p>
              {c.afterInterview.length > 0 && (
                <ul className="divide-y divide-line">
                  {c.afterInterview.slice(0, 30).map((r) => (
                    <li key={r.applicationId} className="flex flex-wrap justify-between gap-2 py-1.5">
                      <span>
                        {r.candidate} <span className="text-muted">· {r.role}</span>
                      </span>
                      <span className="text-[12.5px] text-muted">
                        first scorecard {formatDate(r.firstScorecard)} · {r.change}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </section>
        </>
      )}
    </div>
  );
}
