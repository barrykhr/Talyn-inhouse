import clsx from "clsx";
import Link from "next/link";
import { notFound } from "next/navigation";
import { RoleStatusBadge } from "@/components/status";
import { Badge, Breadcrumbs, Card, EmptyState, PageHeader, SectionTitle } from "@/components/ui";
import { requireAuth } from "@/lib/auth";
import { EXPECTATION_LABEL, INTERVIEWER_ROLE_LABEL, STAGE_LABEL, managerProfiles, managerSummary, stageOf } from "@/lib/calls/core";
import { companyDetail } from "@/server/company-view";

export const metadata = { title: "Company" };

const tone = (n: number | null) => (n === null ? "neutral" : n >= 75 ? "ok" : n >= 50 ? "warn" : "danger");

/**
 * A company profile: its openings, and how its hiring managers interview, counted from calls
 * checked against each role's JD. Every line comes from those counts; nothing is inferred about
 * anyone as a person.
 */
export default async function CompanyPage({ params }: { params: Promise<{ key: string }> }) {
  const auth = await requireAuth();
  const { key } = await params;
  const c = await companyDetail(auth.orgId, auth.orgName, key);
  if (!c) notFound();
  const managers = managerProfiles(c.calls);
  const interviews = c.calls.filter((x) => x.kind !== "intake");
  const scored = interviews.filter((x) => x.questionAlignment !== null);
  const avg = scored.length ? Math.round(scored.reduce((s, x) => s + x.questionAlignment!, 0) / scored.length) : null;
  const covs = interviews.filter((x) => x.essentialCoverage !== null);
  const avgCov = covs.length ? Math.round(covs.reduce((s, x) => s + x.essentialCoverage!, 0) / covs.length) : null;
  const callRole = new Map(c.calls.map((x) => [x.callId, x.roleId]));
  const callHref = (id: string) => `/roles/${callRole.get(id)}/calls/${id}`;

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Companies", href: "/companies" }, { label: c.name }]} />}
        title={c.name}
        meta={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">
            {c.website && (
              <a href={c.website.startsWith("http") ? c.website : `https://${c.website}`} target="_blank" rel="noreferrer" className="text-brand hover:underline">
                {c.website.replace(/^https?:\/\//, "")}
              </a>
            )}
            {c.profile && <span>{STAGE_LABEL[stageOf(c.profile.headcount_band)]}</span>}
            {c.profile?.industry && <span>{c.profile.industry}</span>}
          </span>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-4">
        <Stat label="Open roles" value={String(c.roles.filter((r) => r.status === "open").length)} />
        <Stat label="Calls checked" value={String(c.calls.length)} />
        <Stat label="Questions tied to the JD" value={avg === null ? "–" : `${avg}%`} t={tone(avg)} />
        <Stat label="Essential criteria asked" value={avgCov === null ? "–" : `${avgCov}%`} t={tone(avgCov)} />
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-label="Hiring managers" className="min-w-0 space-y-4">
          <h2 className="text-[15px] font-semibold">How their hiring managers interview</h2>
          {managers.length === 0 ? (
            <EmptyState title="No checked calls yet" body="Add interview or intake calls to this company's roles and check them against the JD. Each hiring manager's profile builds up from there." />
          ) : (
            managers.map((m) => (
              <Card key={m.name} className="p-5">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <p className="text-[16px] font-semibold">{m.name}</p>
                    <p className="text-[12.5px] text-muted">
                      {INTERVIEWER_ROLE_LABEL[m.role]} · {m.interviews} interview{m.interviews === 1 ? "" : "s"}, {m.intakes} intake{m.intakes === 1 ? "" : "s"} · {m.roles.join(", ")}
                    </p>
                  </div>
                  <span className="flex flex-wrap gap-1.5">
                    {m.questionAlignment !== null && <Badge tone={tone(m.questionAlignment)}>Questions on JD {m.questionAlignment}%</Badge>}
                    {m.essentialCoverage !== null && <Badge tone={tone(m.essentialCoverage)}>Essentials asked {m.essentialCoverage}%</Badge>}
                  </span>
                </div>
                <ul className="mt-3 space-y-1 text-[13.5px]">
                  {managerSummary(m).map((l) => (
                    <li key={l}>· {l}</li>
                  ))}
                </ul>
                {m.mix.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">Kinds of question ({m.questionsAsked})</p>
                    <div className="flex h-2 overflow-hidden rounded-full bg-sunken" aria-hidden>
                      {m.mix.map((x, i) => (
                        <span key={x.kind} className={clsx("h-full", ["bg-brand", "bg-ok", "bg-warn", "bg-ink-2", "bg-signal", "bg-faint", "bg-line-strong"][i % 7])} style={{ width: `${(x.count / m.questionsAsked) * 100}%` }} />
                      ))}
                    </div>
                    <p className="mt-1 text-[12px] text-muted">{m.mix.map((x) => `${x.kind} ${x.count}`).join(" · ")}</p>
                  </div>
                )}
                {m.drift.length > 0 && (
                  <div className="mt-3">
                    <p className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-faint">What they want beyond the JD</p>
                    <ul className="space-y-0.5 text-[13px]">
                      {m.drift.slice(0, 6).map((d, i) => (
                        <li key={i}>
                          <Link href={callHref(d.callId)} className="hover:underline">
                            {d.topic}
                          </Link>{" "}
                          <span className="text-[12px] text-muted">· {EXPECTATION_LABEL[d.status]}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
                {m.risky.length > 0 && (
                  <div className="mt-3 rounded-lg bg-danger-soft/50 p-3">
                    <p className="mb-1 text-[12.5px] font-semibold text-danger">Questions to stop asking</p>
                    <ul className="space-y-0.5 text-[13px]">
                      {m.risky.slice(0, 5).map((r, i) => (
                        <li key={i}>
                          <Link href={callHref(r.callId)} className="hover:underline">
                            “{r.question}”
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </Card>
            ))
          )}
          <p className="text-[11.5px] text-faint">Built only from counted facts in checked calls (which questions were asked and what the JD says). It describes interviewing practice, not people, and is meant for coaching and better briefs.</p>
        </section>

        <aside className="space-y-4">
          <Card className="p-4">
            <SectionTitle>Openings</SectionTitle>
            <ul className="divide-y divide-line">
              {c.roles.map((r) => (
                <li key={r.id} className="py-2">
                  <Link href={`/roles/${r.id}/calls`} className="flex items-center justify-between gap-2 hover:underline">
                    <span className="min-w-0 truncate text-[13.5px] font-medium">{r.title}</span>
                    <RoleStatusBadge status={r.status} />
                  </Link>
                  <p className="text-[12px] text-muted">
                    {r.location || "Location not set"} · {r.applicants} candidate{r.applicants === 1 ? "" : "s"} · {r.calls} call{r.calls === 1 ? "" : "s"} checked
                  </p>
                </li>
              ))}
            </ul>
          </Card>
        </aside>
      </div>
    </>
  );
}

function Stat({ label, value, t = "neutral" }: { label: string; value: string; t?: string }) {
  return (
    <Card className="p-3">
      <p className="text-[11.5px] font-semibold uppercase tracking-wide text-faint">{label}</p>
      <p className={clsx("text-[22px] font-semibold tabular-nums", t === "ok" ? "text-ok" : t === "warn" ? "text-warn" : t === "danger" ? "text-danger" : "text-ink")}>{value}</p>
    </Card>
  );
}
