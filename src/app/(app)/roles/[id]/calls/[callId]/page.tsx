import clsx from "clsx";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionButton } from "@/components/client";
import { AiMark, Badge, Breadcrumbs, Card, Notice, PageHeader, SectionTitle, formatDate } from "@/components/ui";
import { aiStatus } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import {
  ANSWER_RATING_LABEL,
  CALL_KIND_LABEL,
  CANDIDATE_ALIGNMENT_LABEL,
  EXPECTATION_LABEL,
  INTERVIEWER_ROLE_LABEL,
  QUESTION_ALIGNMENT_LABEL,
  candidateCounts,
  fmtMs,
  speakersIn,
  type AnswerRating,
  type CallKind,
  type CandidateAlignment,
  type ExpectationStatus,
  type InterviewerRole,
  type QuestionAlignment,
  type Speaker,
} from "@/lib/calls/core";
import { db } from "@/lib/db";
import { CONSENT_LABEL } from "@/lib/transcripts/parse";
import { analyzeCall, deleteCall, type BankQuestion } from "@/server/call-actions";
import { callSetupOptions } from "@/server/call-view";
import { ownRole } from "@/server/scope";
import { CallDetailsForm, SpeakersForm } from "../forms";

export const metadata = { title: "Call" };
export const maxDuration = 300;

type CandItem = { criterion_id: string; name: string; essential: boolean; status: CandidateAlignment; note: string; quote: string; passage: number | null };
type QItem = { passage: number; question: string; criterion: string | null; alignment: QuestionAlignment; kind: string; note: string };
type CovItem = { criterion_id: string; name: string; essential: boolean; asked: boolean; passages: number[] };
type ExpItem = { topic: string; said: string; passage: number; jd_says: string; status: ExpectationStatus };
type BItem = { question_id: string; asked: boolean; answer_quote: string; passage: number | null; rating: AnswerRating; matched_signals: string[]; missing_signals: string[]; suggestion: string };

const CAND_TONE: Record<CandidateAlignment, string> = { aligned: "bg-ok-soft text-ok", partly: "bg-warn-soft text-warn", not_aligned: "bg-danger-soft text-danger", not_discussed: "bg-sunken text-muted" };
const Q_TONE: Record<QuestionAlignment, string> = { on_jd: "bg-ok-soft text-ok", partly: "bg-warn-soft text-warn", off_jd: "bg-sunken text-ink-2", risky: "bg-danger-soft text-danger" };
const EXP_TONE: Record<ExpectationStatus, string> = { matches: "bg-ok-soft text-ok", adds: "bg-warn-soft text-warn", conflicts: "bg-danger-soft text-danger", not_in_jd: "bg-sunken text-ink-2" };
const R_TONE: Record<AnswerRating, string> = { strong: "bg-ok-soft text-ok", mixed: "bg-warn-soft text-warn", weak: "bg-danger-soft text-danger", not_answered: "bg-sunken text-muted" };
const ROLE_TONE: Record<string, string> = { candidate: "border-brand", interviewer: "border-ink", other: "border-line-strong" };

const Tag = ({ cls, children }: { cls: string; children: React.ReactNode }) => <span className={clsx("inline-block shrink-0 rounded px-1.5 py-px text-[11.5px] font-semibold", cls)}>{children}</span>;
const At = ({ n, ms }: { n: number | null; ms: Map<number, number> }) =>
  n ? (
    <a href={`#p-${n}`} className="font-mono text-[11.5px] text-brand hover:underline">
      {fmtMs(ms.get(n) ?? 0)}
    </a>
  ) : null;

export default async function CallPage({ params }: { params: Promise<{ id: string; callId: string }> }) {
  const auth = await requireAuth();
  const { id, callId } = await params;
  const role = await ownRole(auth, id);
  const call = await db.roleCall.findFirst({ where: { id: callId, orgId: auth.orgId, roleId: id }, include: { segments: { orderBy: { idx: "asc" } }, analysis: true } });
  if (!call) notFound();
  const [{ roles, byRole }, candidate, bankRow] = await Promise.all([
    callSetupOptions(auth.orgId),
    call.candidateId ? db.candidate.findFirst({ where: { id: call.candidateId, orgId: auth.orgId }, select: { id: true, fullName: true } }) : null,
    db.behaviouralSet.findUnique({ where: { roleId: id }, select: { questionsJson: true } }),
  ]);
  const speakers = JSON.parse(call.speakersJson) as Speaker[];
  const stats = Object.fromEntries(speakersIn(call.segments).map((s) => [s.label, s]));
  const roleOf = new Map(speakers.map((s) => [s.label, s.role]));
  const startMs = new Map(call.segments.map((s) => [s.idx + 1, s.startMs]));
  const a = call.analysis;
  const outdated = a && a.criteriaVersion !== role.criteriaVersion;
  const ai = aiStatus().configured;
  const intake = call.kind === "intake";
  const needsCandidate = !intake && !speakers.some((s) => s.role === "candidate");
  const bank = new Map((bankRow ? (JSON.parse(bankRow.questionsJson) as BankQuestion[]) : []).map((q) => [q.id, q]));

  const cand = a ? (JSON.parse(a.candidateJson) as CandItem[]) : [];
  const qs = a ? (JSON.parse(a.questionsJson) as QItem[]) : [];
  const cov = a ? (JSON.parse(a.coverageJson) as CovItem[]) : [];
  const exp = a ? (JSON.parse(a.expectationsJson) as ExpItem[]) : [];
  const beh = a ? (JSON.parse(a.behaviouralJson) as BItem[]) : [];
  const sugg = a ? (JSON.parse(a.suggestionsJson) as { text: string; why: string }[]) : [];
  const counts = candidateCounts(cand);
  const missed = cov.filter((c) => c.essential && !c.asked);

  return (
    <>
      <PageHeader
        eyebrow={<Breadcrumbs items={[{ label: "Roles", href: "/roles" }, { label: role.title, href: `/roles/${role.id}` }, { label: "Calls", href: `/roles/${role.id}/calls` }, { label: call.title }]} />}
        title={call.title}
        meta={
          <span className="text-[13px] text-muted">
            {CALL_KIND_LABEL[call.kind as CallKind]}
            {candidate && (
              <>
                {" · "}
                <Link href={`/candidates/${candidate.id}?role=${role.id}`} className="text-brand hover:underline">
                  {candidate.fullName}
                </Link>
              </>
            )}
            {call.interviewerName && ` · ${INTERVIEWER_ROLE_LABEL[call.interviewerRole as InterviewerRole]}: ${call.interviewerName}`} · {formatDate(call.occurredAt ?? call.createdAt)}
            {call.durationMs ? ` · ${fmtMs(call.durationMs)}` : ""}
          </span>
        }
        actions={<ActionButton action={deleteCall.bind(null, call.id)} variant="ghost" confirm="Delete this call and its transcript? This can't be undone.">Delete call</ActionButton>}
      />

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_380px]">
        <div className="min-w-0 space-y-4">
          {call.status === "needs_role" && <Notice tone="warn">This call came from your notetaker. Confirm who was on it below before checking it.</Notice>}

          <Card className="p-5">
            <SectionTitle
              hint={intake ? "Compares what the hiring manager expects with the JD and the approved criteria." : "Checks the candidate against the JD, the interviewer's questions against the JD, and behavioural answers against the benchmark."}
              action={
                ai ? (
                  <ActionButton action={analyzeCall.bind(null, call.id)} variant={a && !outdated ? "secondary" : "primary"} pendingLabel="Checking… (up to a minute)" disabled={needsCandidate || call.status === "needs_role"}>
                    {a ? "Check again" : "Check against the JD"}
                  </ActionButton>
                ) : undefined
              }
            >
              Alignment with the JD
            </SectionTitle>
            {!ai && <Notice tone="warn">AI is off for this workspace, so calls can&apos;t be checked yet. The transcript is saved.</Notice>}
            {needsCandidate && <Notice tone="warn">Mark which speaker is the candidate (right) before checking.</Notice>}
            {call.status === "failed" && <Notice tone="danger">The last check didn&apos;t finish. Try again.</Notice>}
            {outdated && <Notice tone="warn">The role&apos;s criteria changed since this check. Check again to use the current criteria.</Notice>}
            {a && (
              <p className="mt-1 flex items-center gap-1.5 text-[12px] text-faint">
                <AiMark /> Suggestions from {a.model.replace(/^ai:/, "")} · {formatDate(a.createdAt)} by {a.createdByName}. Quotes are checked against the transcript; anything not found was dropped.
              </p>
            )}
          </Card>

          {a && !intake && (
            <>
              <Card className="p-5">
                <SectionTitle hint="What the candidate said, criterion by criterion. Not discussed means it didn't come up, not that they lack it.">1. The candidate against the JD</SectionTitle>
                {counts.essential > 0 && (
                  <p className="mb-3 text-[13px]">
                    <span className="font-semibold">
                      Matches {counts.aligned} of {counts.essential} essential criteria
                    </span>
                    <span className="text-muted">
                      {" "}
                      · {counts.partly} partly · {counts.notAligned} don&apos;t match · {counts.notDiscussed} not discussed
                    </span>
                  </p>
                )}
                <ul className="divide-y divide-line rounded-xl border border-line">
                  {cand.map((c) => (
                    <li key={c.criterion_id} className="flex items-start gap-3 px-3 py-2.5">
                      <Tag cls={clsx("w-[112px] text-center", CAND_TONE[c.status])}>{CANDIDATE_ALIGNMENT_LABEL[c.status]}</Tag>
                      <div className="min-w-0 flex-1 text-[13px]">
                        <p className="font-medium">
                          {c.name}
                          {!c.essential && <span className="ml-1.5 text-[11.5px] font-normal text-faint">preferred</span>}
                        </p>
                        <p className="text-ink-2">{c.note}</p>
                        {c.quote && (
                          <p className="quote mt-0.5 text-[12.5px] text-ink-2">
                            “{c.quote}” <At n={c.passage} ms={startMs} />
                          </p>
                        )}
                      </div>
                    </li>
                  ))}
                </ul>
              </Card>

              <Card className="p-5">
                <SectionTitle hint={`Every question ${call.interviewerName ?? "the interviewer"} asked, and whether it tests something the JD asks for.`}>2. The questions against the JD</SectionTitle>
                <div className="mb-3 flex flex-wrap gap-2">
                  {a.questionAlignment !== null && <Badge tone={a.questionAlignment >= 75 ? "ok" : a.questionAlignment >= 50 ? "warn" : "danger"}>{a.questionAlignment}% of questions tied to the JD</Badge>}
                  {a.essentialCoverage !== null && <Badge tone={a.essentialCoverage >= 75 ? "ok" : a.essentialCoverage >= 50 ? "warn" : "danger"}>{a.essentialCoverage}% of essential criteria asked about</Badge>}
                  <Badge>{qs.filter((q) => q.kind !== "logistics").length} questions</Badge>
                  {qs.some((q) => q.alignment === "risky") && <Badge tone="danger">{qs.filter((q) => q.alignment === "risky").length} to avoid</Badge>}
                </div>
                {missed.length > 0 && (
                  <p className="mb-3 rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-ink">
                    <span className="font-semibold">Never asked about:</span> {missed.map((m) => m.name).join(", ")}
                  </p>
                )}
                <ol className="divide-y divide-line rounded-xl border border-line">
                  {qs.map((q, i) => (
                    <li key={i} className={clsx("flex items-start gap-3 px-3 py-2.5", q.alignment === "risky" && "bg-danger-soft/40")}>
                      <span className="w-10 shrink-0 pt-0.5">
                        <At n={q.passage} ms={startMs} />
                      </span>
                      <div className="min-w-0 flex-1 text-[13px]">
                        <p>“{q.question}”</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-[12px] text-muted">
                          <Tag cls={Q_TONE[q.alignment]}>{QUESTION_ALIGNMENT_LABEL[q.alignment]}</Tag>
                          {q.criterion && <span>Tests: {q.criterion}</span>}
                          <span>· {q.kind}</span>
                          {q.note && <span>· {q.note}</span>}
                        </p>
                      </div>
                    </li>
                  ))}
                </ol>
              </Card>

              <Card className="p-5">
                <SectionTitle
                  hint="The role's behavioural questions that came up, compared with what a strong answer covers."
                  action={
                    <Link href={`/roles/${role.id}/calls?view=questions`} className="text-[12.5px] font-medium text-brand hover:underline">
                      Question bank →
                    </Link>
                  }
                >
                  3. Behavioural answers against the benchmark
                </SectionTitle>
                {bank.size === 0 ? (
                  <p className="text-[13px] text-muted">No behavioural question bank for this role yet. Write one, then check this call again.</p>
                ) : beh.filter((b) => b.asked).length === 0 ? (
                  <p className="text-[13px] text-muted">None of the role&apos;s behavioural questions came up in this call.</p>
                ) : (
                  <ul className="space-y-3">
                    {beh
                      .filter((b) => b.asked)
                      .map((b) => (
                        <li key={b.question_id} className="rounded-xl border border-line p-3 text-[13px]">
                          <p className="font-medium">“{bank.get(b.question_id)?.question}”</p>
                          <p className="mt-1">
                            <Tag cls={R_TONE[b.rating]}>{ANSWER_RATING_LABEL[b.rating]}</Tag>
                          </p>
                          {b.answer_quote && (
                            <p className="quote mt-1 text-[12.5px] text-ink-2">
                              “{b.answer_quote}” <At n={b.passage} ms={startMs} />
                            </p>
                          )}
                          {b.matched_signals.length > 0 && <p className="mt-1"><span className="font-medium text-ok">Matched:</span> {b.matched_signals.join("; ")}</p>}
                          {b.missing_signals.length > 0 && <p><span className="font-medium text-warn">Missing:</span> {b.missing_signals.join("; ")}</p>}
                          <p className="mt-1"><span className="font-medium">Suggestion:</span> {b.suggestion}</p>
                        </li>
                      ))}
                  </ul>
                )}
                {beh.some((b) => !b.asked) && <p className="mt-3 text-[12.5px] text-muted">Not asked in this call: {beh.filter((b) => !b.asked).map((b) => bank.get(b.question_id)?.theme).filter(Boolean).join(", ")}.</p>}
              </Card>
            </>
          )}

          {a && intake && (
            <Card className="p-5">
              <SectionTitle hint={`What ${call.interviewerName ?? "the hiring manager"} said they want, next to what the JD says.`}>The hiring manager&apos;s expectations against the JD</SectionTitle>
              <ul className="divide-y divide-line rounded-xl border border-line">
                {exp.map((e, i) => (
                  <li key={i} className="flex items-start gap-3 px-3 py-2.5 text-[13px]">
                    <Tag cls={clsx("w-[132px] text-center", EXP_TONE[e.status])}>{EXPECTATION_LABEL[e.status]}</Tag>
                    <div className="min-w-0 flex-1">
                      <p className="font-medium">{e.topic}</p>
                      <p className="quote text-[12.5px] text-ink-2">
                        “{e.said}” <At n={e.passage} ms={startMs} />
                      </p>
                      <p className="text-[12.5px] text-muted">JD: {e.jd_says}</p>
                    </div>
                  </li>
                ))}
              </ul>
              {missed.length > 0 && <p className="mt-3 text-[13px] text-muted">Essential criteria the hiring manager didn&apos;t mention: {missed.map((m) => m.name).join(", ")}.</p>}
            </Card>
          )}

          {a && sugg.length > 0 && (
            <Card className="p-5">
              <SectionTitle>Suggested next steps</SectionTitle>
              <ul className="space-y-2 text-[13px]">
                {sugg.map((s, i) => (
                  <li key={i}>
                    <span className="font-medium">{s.text}</span>
                    <span className="block text-muted">{s.why}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-3 text-[11.5px] text-faint">Suggestions only. Nothing here changes a stage or decision, or contacts anyone.</p>
            </Card>
          )}

          <Card className="p-5">
            <SectionTitle hint={`${call.segments.length} passages`}>Transcript</SectionTitle>
            <ol className="space-y-1.5">
              {call.segments.map((s) => (
                <li key={s.id} id={`p-${s.idx + 1}`} className={clsx("scroll-mt-24 border-l-2 pl-3 text-[13px] target:bg-brand-soft", ROLE_TONE[roleOf.get(s.speaker) ?? "other"])}>
                  <span className="mr-2 font-mono text-[11.5px] text-faint">{fmtMs(s.startMs)}</span>
                  <span className="font-medium">{s.speaker}</span>
                  {roleOf.get(s.speaker) && roleOf.get(s.speaker) !== "other" && <span className="ml-1 text-[11px] text-faint">({roleOf.get(s.speaker)})</span>}
                  <span className="block text-ink-2">{s.text}</span>
                </li>
              ))}
            </ol>
          </Card>
        </div>

        <aside className="space-y-4">
          {!intake && (
            <Card className="p-4">
              <SectionTitle hint="Guessed from names only. Correct anything wrong before checking.">Who is who</SectionTitle>
              <SpeakersForm callId={call.id} speakers={speakers} stats={stats} />
            </Card>
          )}
          <Card className="p-4">
            <details open={call.status === "needs_role"}>
              <summary className="cursor-pointer text-[14px] font-semibold">Call details</summary>
              <div className="mt-3">
                <CallDetailsForm
                  callId={call.id}
                  roles={roles}
                  current={{ roleId: call.roleId, kind: call.kind, interviewerName: call.interviewerName, interviewerRole: call.interviewerRole, applicationId: call.applicationId, title: call.title }}
                  applicationsByRole={byRole}
                />
              </div>
            </details>
          </Card>
          <Card className="p-4 text-[12.5px] text-muted">
            <p>
              <span className="font-medium text-ink">Consent:</span> {CONSENT_LABEL[call.consentMethod] ?? call.consentMethod}, confirmed by {call.consentByName} on {formatDate(call.consentAt)}.
            </p>
            <p className="mt-1">
              <span className="font-medium text-ink">Source:</span> {call.source === "notetaker" ? call.provider.split(":")[1] : call.source === "upload" ? "Uploaded file" : "Pasted"} · added by {call.createdByName}
            </p>
          </Card>
        </aside>
      </div>
    </>
  );
}
