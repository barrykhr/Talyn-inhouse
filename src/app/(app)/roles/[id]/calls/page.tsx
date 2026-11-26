import clsx from "clsx";
import Link from "next/link";
import { RoleTabs } from "@/components/role-workspace";
import { RoleStatusBadge } from "@/components/status";
import { AiMark, Badge, Breadcrumbs, Card, EmptyState, Notice, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { CALL_KIND_LABEL, STAGE_LABEL, companyKey, stageOf, type CallKind } from "@/lib/calls/core";
import { db } from "@/lib/db";
import { parseClientProfile } from "@/lib/discovery/target-companies";
import type { BankQuestion } from "@/server/call-actions";
import { ownRole } from "@/server/scope";
import { AddCallForm, AnswerCheck, GenerateBankForm } from "./forms";

export const metadata = { title: "Calls" };
// Writing the question bank runs an AI step.
export const maxDuration = 300;

const pctTone = (n: number | null) => (n === null ? "neutral" : n >= 75 ? "ok" : n >= 50 ? "warn" : "danger");

/** Role → Calls: every call transcript for this role, checked against the JD, and the behavioural question bank. */
export default async function RoleCallsPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ view?: string }> }) {
  const auth = await requireAuth();
  const { id } = await params;
  const { view } = await searchParams;
  const role = await ownRole(auth, id);
  const [calls, apps, criteria, toReview, org, bank, target, kits] = await Promise.all([
    db.roleCall.findMany({
      where: { orgId: auth.orgId, roleId: id },
      orderBy: [{ occurredAt: "desc" }, { createdAt: "desc" }],
      select: { id: true, title: true, kind: true, occurredAt: true, createdAt: true, interviewerName: true, status: true, source: true, candidateId: true, analysis: { select: { questionAlignment: true, essentialCoverage: true, candidateJson: true, expectationsJson: true } } },
    }),
    db.application.findMany({ where: { orgId: auth.orgId, roleId: id }, select: { id: true, origin: true, decision: true, stage: true, candidate: { select: { id: true, fullName: true } } } }),
    db.criterion.findMany({ where: { roleId: id, orgId: auth.orgId }, select: { status: true } }),
    db.sourcedProfile.count({ where: { orgId: auth.orgId, roleId: id, status: "new" } }),
    db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { recordingEnabled: true, recordingPolicy: true } }),
    db.behaviouralSet.findUnique({ where: { roleId: id } }),
    db.targetCompanySet.findUnique({ where: { roleId: id }, select: { clientProfileJson: true } }),
    db.interviewKit.count({ where: { orgId: auth.orgId, roleId: id } }),
  ]);
  const names = new Map(apps.map((a) => [a.candidate.id, a.candidate.fullName]));
  const active = apps.filter((a) => a.stage !== "rejected" && a.stage !== "hired");
  const ai = aiStatus().configured;
  const tab = view === "questions" ? "questions" : "calls";
  const headcount = bank?.companySize ?? parseClientProfile(target?.clientProfileJson)?.headcount_band ?? "not known";

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Roles", href: "/roles" }, { label: role.title, href: `/roles/${role.id}` }, { label: "Calls" }]} />}
        title={
          <span className="flex flex-wrap items-center gap-2">
            {role.title} <RoleStatusBadge status={role.status} />
          </span>
        }
        meta={
          role.clientCompanyName ? (
            <Link href={`/companies/${companyKey(role.clientCompanyName)}`} className="text-[13px] text-brand hover:underline">
              {role.clientCompanyName} company profile →
            </Link>
          ) : undefined
        }
      />
      <RoleTabs
        roleId={role.id}
        active="calls"
        counts={{ applicants: apps.filter((a) => a.origin !== "discovered").length, discover: toReview, shortlist: apps.filter((a) => a.decision === "advance").length, criteria: criteria.filter((c) => c.status === "approved").length, interviews: kits, calls: calls.length }}
        attention={{ criteria: criteria.filter((c) => c.status === "proposed").length }}
      />

      <nav aria-label="Calls views" className="mb-4 flex gap-1">
        {(
          [
            ["calls", "Calls", calls.length],
            ["questions", "Behavioural questions", bank ? (JSON.parse(bank.questionsJson) as unknown[]).length : 0],
          ] as const
        ).map(([k, label, n]) => (
          <Link key={k} href={`/roles/${role.id}/calls${k === "questions" ? "?view=questions" : ""}`} aria-current={tab === k ? "page" : undefined} className={clsx("rounded-md px-2.5 py-1 text-[13px] font-medium transition-colors", tab === k ? "bg-ink text-white" : "text-muted hover:bg-sunken hover:text-ink")}>
            {label}
            {n > 0 && <span className="ml-1.5 tabular-nums opacity-70">{n}</span>}
          </Link>
        ))}
      </nav>

      {tab === "calls" ? (
        <div className="space-y-4">
          <p className="text-[13px] text-muted">
            Every call for this role in one place. Talyn checks each one against the JD two ways: what the candidate said against what the role needs, and whether the questions asked match the JD. Intake calls compare
            the hiring manager&apos;s expectations with the JD. Everything is a suggestion with the quote it came from; people decide.
          </p>
          {calls.length === 0 ? (
            <EmptyState title="No calls yet" body="Add a transcript below, or connect a notetaker in Integrations so calls arrive on their own." />
          ) : (
            <Card className="overflow-hidden">
              <ul className="divide-y divide-line">
                {calls.map((c) => {
                  const a = c.analysis;
                  const cand = a ? (JSON.parse(a.candidateJson) as { essential: boolean; status: string }[]).filter((x) => x.essential) : [];
                  const drift = a ? (JSON.parse(a.expectationsJson) as { status: string }[]).filter((x) => x.status !== "matches").length : 0;
                  return (
                    <li key={c.id} className="motion-row">
                      <Link href={`/roles/${role.id}/calls/${c.id}`} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3 hover:bg-sunken/60">
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[14px] font-medium">{c.title}</span>
                          <span className="block text-[12.5px] text-muted">
                            {CALL_KIND_LABEL[c.kind as CallKind]}
                            {c.candidateId && names.get(c.candidateId) ? ` · ${names.get(c.candidateId)}` : ""}
                            {c.interviewerName ? ` · with ${c.interviewerName}` : ""} · {formatDate(c.occurredAt ?? c.createdAt)}
                            {c.source === "notetaker" ? " · from notetaker" : ""}
                          </span>
                        </span>
                        <span className="flex flex-wrap items-center gap-1.5">
                          {c.status === "needs_role" && <Badge tone="warn">Needs setup</Badge>}
                          {c.status === "failed" && <Badge tone="danger">Check failed</Badge>}
                          {c.status === "ready" && <Badge>Not checked yet</Badge>}
                          {a?.questionAlignment != null && <Badge tone={pctTone(a.questionAlignment)} title="Share of the interviewer's questions tied to the JD">Questions on JD {a.questionAlignment}%</Badge>}
                          {a?.essentialCoverage != null && c.kind !== "intake" && <Badge tone={pctTone(a.essentialCoverage)} title="Essential criteria the interviewer asked about">Essentials asked {a.essentialCoverage}%</Badge>}
                          {cand.length > 0 && <Badge tone="brand" title="Essential criteria where what the candidate said matches the JD">Candidate matches {cand.filter((x) => x.status === "aligned").length} of {cand.length}</Badge>}
                          {c.kind === "intake" && a && <Badge tone={drift ? "warn" : "ok"}>{drift ? `${drift} expectation${drift === 1 ? "" : "s"} differ from JD` : "Matches the JD"}</Badge>}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle hint="Calls from a connected notetaker arrive automatically and wait in your inbox to be set up.">Add a call</SectionTitle>
            {!org.recordingEnabled ? (
              <Notice tone="warn">
                Recording &amp; transcription is off for this workspace. An admin can turn it on in{" "}
                <Link href="/settings#recording" className="font-medium underline">
                  Workspace settings
                </Link>{" "}
                with your consent process.
              </Notice>
            ) : (
              <AddCallForm roleId={role.id} applications={active.map((a) => ({ id: a.id, name: a.candidate.fullName }))} policy={org.recordingPolicy} />
            )}
          </Card>
        </div>
      ) : (
        <BehaviouralView roleId={role.id} bank={bank} headcount={headcount} ai={ai} />
      )}
    </>
  );
}

function BehaviouralView({ roleId, bank, headcount, ai }: { roleId: string; bank: { questionsJson: string; scenariosJson: string; companySize: string; generatedByName: string; generatedAt: Date; model: string } | null; headcount: string; ai: boolean }) {
  const questions = bank ? (JSON.parse(bank.questionsJson) as BankQuestion[]) : [];
  const scenarios = bank ? (JSON.parse(bank.scenariosJson) as { id: string; from: string; to: string; why: string }[]) : [];
  const scen = new Map(scenarios.map((s) => [s.id, s]));
  const themes = [...new Set(questions.map((q) => q.theme))];
  return (
    <div className="space-y-4">
      <p className="text-[13px] text-muted">
        Behavioural questions for recruiters, tuned to the hiring company&apos;s size: why someone would make this move, how much autonomy they really had, and how they handle the way this company works. Each has a ladder of
        deeper follow-ups and a benchmark of what a strong answer covers. Answers from calls are compared with the benchmark automatically; you can also check answers from your notes.
      </p>
      <Card className="p-5">
        {!ai ? (
          <Notice tone="warn">AI is off for this workspace, so questions can&apos;t be written yet.</Notice>
        ) : (
          <GenerateBankForm roleId={roleId} headcount={headcount} again={!!bank} />
        )}
        {bank && (
          <p className="mt-3 flex items-center gap-1.5 text-[12px] text-faint">
            <AiMark /> For a {STAGE_LABEL[stageOf(bank.companySize)].toLowerCase()} · written {formatDate(bank.generatedAt)} by {bank.generatedByName}
          </p>
        )}
      </Card>

      {scenarios.length > 0 && (
        <section aria-label="Moves these questions target">
          <h2 className="mb-2 text-[13px] font-semibold">Moves candidates usually make into this company</h2>
          <ul className="grid gap-2 sm:grid-cols-2">
            {scenarios.map((s) => (
              <li key={s.id} className="rounded-lg border border-line bg-surface px-3 py-2 text-[13px]">
                <span className="font-medium">
                  {s.from} → {s.to}
                </span>
                <span className="block text-[12.5px] text-muted">{s.why}</span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {themes.map((t) => (
        <section key={t} aria-label={t}>
          <h2 className="mb-2 mt-2 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{t}</h2>
          <div className="space-y-3">
            {questions
              .filter((q) => q.theme === t)
              .map((q) => (
                <Card key={q.id} className="p-4">
                  <p className="text-[15px] font-semibold leading-snug">“{q.question}”</p>
                  {q.scenario_id && scen.get(q.scenario_id) && <p className="mt-1 text-[12px] text-brand">For people moving {scen.get(q.scenario_id)!.from} → {scen.get(q.scenario_id)!.to}</p>}
                  <p className="mt-1 text-[13px] text-muted">{q.why}</p>

                  <ol className="mt-3 space-y-1.5" aria-label="Follow-up ladder">
                    {q.probes.map((p, i) => (
                      <li key={i} className="flex gap-2 text-[13px]" style={{ paddingLeft: `${Math.min(i, 3) * 14}px` }}>
                        <span className="mt-px shrink-0 rounded bg-sunken px-1.5 text-[11px] font-semibold tabular-nums text-ink-2">L{p.level}</span>
                        <span>
                          {p.question}
                          <span className="block text-[12px] text-faint">Listen for: {p.listen_for}</span>
                        </span>
                      </li>
                    ))}
                  </ol>

                  <div className="mt-3 rounded-lg bg-sunken/60 p-3 text-[13px]">
                    <p className="font-medium">What a strong answer looks like</p>
                    <p className="text-ink-2">{q.benchmark}</p>
                    <div className="mt-2 grid gap-2 sm:grid-cols-3">
                      <SignalList title="Strong signals" tone="text-ok" items={q.strong_signals} />
                      <SignalList title="Weak signals" tone="text-warn" items={q.weak_signals} />
                      <SignalList title="Red flags" tone="text-danger" items={q.red_flags} />
                    </div>
                  </div>
                  <div className="mt-2">{ai && <AnswerCheck roleId={roleId} questionId={q.id} />}</div>
                </Card>
              ))}
          </div>
        </section>
      ))}
    </div>
  );
}

function SignalList({ title, tone, items }: { title: string; tone: string; items: string[] }) {
  if (!items.length) return null;
  return (
    <div>
      <p className={clsx("text-[11.5px] font-semibold uppercase tracking-wide", tone)}>{title}</p>
      <ul className="mt-0.5 space-y-0.5 text-[12.5px] text-ink-2">
        {items.map((s) => (
          <li key={s}>· {s}</li>
        ))}
      </ul>
    </div>
  );
}
