"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { ActionForm, ActionButton, FormMessage, Spinner, SubmitButton, useServerForm } from "@/components/client";
import { AiMark, Badge, Button, Field, Notice, Select, Textarea } from "@/components/ui";
import { EVIDENCE_TIER, EVIDENCE_TIER_LABEL, RECOMMENDATIONS, RECOMMENDATION_LABEL, RESULT_HELP, RESULT_LABEL, RESULTS, type AssessmentResult, type Evidence, type Recommendation } from "@/lib/domain";
import { useSourceViewer } from "@/components/source-viewer";
import { SkillStatusBadge } from "@/components/skill-match";
import { evidenceOriginLabel } from "@/lib/evidence";
import { SKILL_STATUS_LABEL, SKILL_STATUS_RESULT, skillStatus } from "@/lib/skills";
import { StagedProgress } from "@/components/staged-progress";
import { useToast } from "@/components/toast";
import { markReviewed, overrideItem, restoreCorrection, reviewRecommendation, runAssessment } from "@/server/assessment-actions";
import { createInfoRequest } from "@/server/task-actions";
import type { ActionState } from "@/server/form";

export type ItemView = {
  id: string;
  criterionName: string;
  importance: string;
  kind: string;
  result: string;
  evidence: Evidence[];
  explanation: string;
  missingInfo: string;
  confidence: string | null;
  overrideResult: string | null;
  overrideNote: string | null;
  overriddenBy: string | null;
  overriddenAt: string | null;
  corrections: CorrectionView[];
};
export type CorrectionView = { id: string; fromResult: string | null; toResult: string | null; note: string | null; fromNote: string | null; byName: string; createdAt: string; restored: boolean };

const resultTone: Record<string, "ok" | "warn" | "gap" | "danger"> = {
  supported: "ok",
  partially_supported: "warn",
  inferred: "warn",
  conflicting: "danger",
  not_stated: "gap",
};

const tierClass = { found: "text-ok", uncertain: "text-warn", missing: "text-gap" } as const;
/** Quick read: evidence found, uncertain or missing. The detailed result badge stays next to it. */
function TierLabel({ result }: { result: string }) {
  const t = EVIDENCE_TIER[result as AssessmentResult];
  if (!t) return null;
  return <span className={clsx("text-[12px] font-semibold", tierClass[t])}>{EVIDENCE_TIER_LABEL[t]}</span>;
}

export function ResultBadge({ result, struck = false }: { result: string; struck?: boolean }) {
  const r = result as AssessmentResult;
  return (
    <Badge tone={resultTone[r] ?? "neutral"} title={RESULT_HELP[r]} className={clsx(struck && "line-through opacity-60")}>
      <ResultIcon result={r} />
      {RESULT_LABEL[r] ?? result}
    </Badge>
  );
}

function ResultIcon({ result }: { result: AssessmentResult }) {
  if (result === "supported")
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M2 5.2l2 2L8 3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
    );
  if (result === "partially_supported")
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path d="M5 1.5a3.5 3.5 0 010 7z" fill="currentColor" />
      </svg>
    );
  if (result === "conflicting")
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M2 3h6M2 7h6M6.5 1.5L8 3 6.5 4.5M3.5 5.5L2 7l1.5 1.5" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </svg>
    );
  if (result === "inferred")
    return (
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeDasharray="2 1.5" />
      </svg>
    );
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
      <path d="M2.5 5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

export function RunAssessment({ applicationId, aiConfigured, hasAssessment, disabledReason }: { applicationId: string; aiConfigured: boolean; hasAssessment: boolean; disabledReason?: string }) {
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState<"ai" | "keyword" | null>(null);
  const [state, setState] = useState<ActionState>(undefined);
  const run = async (m: "ai" | "keyword") => {
    if (hasAssessment && !window.confirm("Create a new assessment? The current one stays in history.")) return;
    setMode(m);
    setState(undefined);
    setPending(true);
    let result: ActionState;
    try {
      result = await runAssessment(applicationId, m);
    } catch {
      result = { error: "The assessment request failed. Please try again." };
    }
    // Reload to show the stored assessment (see useServerForm for why not a client refresh).
    if (result?.ok) return window.location.reload();
    setState(result);
    setPending(false);
  };
  return (
    <div className="flex flex-col items-end gap-2">
      <div className="flex flex-wrap justify-end gap-2">
        <Button
          variant="signal"
          disabled={pending || !aiConfigured || !!disabledReason}
          onClick={() => run("ai")}
          title={aiConfigured ? "AI reads the CV against each approved criterion and cites evidence" : "Add an AI API key in Settings to enable"}
        >
          {hasAssessment ? "Re-assess with AI" : "Assess with AI"}
        </Button>
        <Button variant="secondary" disabled={pending || !!disabledReason} onClick={() => run("keyword")} title="Finds CV lines containing criterion keywords. Not AI.">
          Keyword check (no AI)
        </Button>
      </div>
      {pending && (
        <div className="w-full min-w-72 rounded-xl border border-line bg-surface px-4 py-3">
          <StagedProgress
            stages={[
              {
                key: "assess",
                label: mode === "ai" ? "Mapping the CV to the approved criteria" : "Matching criterion keywords in the CV",
                detail: mode === "ai" ? "Then Talyn computes the score and the AI drafts a recommendation for your review" : null,
                state: "active",
                slow: mode === "ai",
              },
            ]}
          />
        </div>
      )}
      {disabledReason && <p className="text-[13px] text-warn">{disabledReason}</p>}
      {!aiConfigured && !disabledReason && <p className="text-[12.5px] text-muted">AI assessment is off — add an AI API key in Settings to enable it.</p>}
      {state?.error && <p className="text-[13px] text-danger">{state.error}</p>}
    </div>
  );
}

function CitationButton({ evidence: e }: { evidence: Evidence }) {
  const openSource = useSourceViewer();
  const label = evidenceOriginLabel(e);
  if (e.source === "source")
    return e.url ? (
      <a href={e.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 underline-offset-2 hover:text-ink hover:underline" title="Open the source record">
        {label}
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M3.5 2h4.5v4.5M8 2L3 7" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
        </svg>
      </a>
    ) : (
      <span>{label}</span>
    );
  const src = e.source;
  if (!openSource || !e.verified) return <span>{label}</span>;
  return (
    <button
      type="button"
      onClick={() => openSource({ source: src, page: e.page, quote: e.quote, label })}
      className="inline-flex items-center gap-1 rounded underline-offset-2 hover:text-ink hover:underline"
      title="Open the source with this passage highlighted"
    >
      {label}
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M3.5 2h4.5v4.5M8 2L3 7" stroke="currentColor" strokeWidth="1.3" fill="none" strokeLinecap="round" />
      </svg>
    </button>
  );
}

export function ItemCard({ item }: { item: ItemView }) {
  const [correcting, setCorrecting] = useState(false);
  const effective = item.overrideResult ?? item.result;
  return (
    <div className="px-4 py-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-medium">{item.criterionName}</span>
            <span className="text-[12px] text-muted">{item.importance === "essential" ? "Required" : item.importance === "preferred" ? "Preferred" : "Informational · not weighted"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <TierLabel result={effective} />
          {item.overrideResult && <ResultBadge result={item.result} struck />}
          <ResultBadge result={effective} />
          {item.confidence && !item.overrideResult && (
            <span className="text-[12px] text-muted" title="How certain the assessment is, given the available evidence">{item.confidence} confidence</span>
          )}
        </div>
      </div>

      {item.overrideResult && (
        <div className="mt-2 rounded-lg border border-line bg-sunken px-3 py-2 text-[13px]">
          <span className="font-medium">Recruiter correction</span>
          <span className="text-muted"> · {item.overriddenBy}</span>
          {item.overrideNote && <p className="mt-0.5 text-ink-2">{item.overrideNote}</p>}
        </div>
      )}

      <div className="mt-3 grid gap-3 md:grid-cols-[1fr_1fr]">
        <div>
          <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Evidence</div>
          {item.evidence.length === 0 ? (
            <p className="text-[13px] text-faint">No supporting text found.</p>
          ) : (
            <ul className="space-y-2">
              {item.evidence.map((e, i) => (
                <li key={i} className={clsx("rounded-lg border-l-2 bg-[#fbfaf7] px-3 py-2", e.verified ? "border-ok" : "border-warn")}>
                  <p className="quote text-ink">“{e.quote}”</p>
                  <div className="mt-1 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
                    <CitationButton evidence={e} />
                    {e.verified ? (
                      <span className="text-ok" title="The quoted text appears in the candidate's material. A recruiter should still judge whether it meets the criterion.">✓ quote matched</span>
                    ) : (
                      <span className="text-warn" title="This text could not be found verbatim in the candidate's material">⚠ quote not matched — check the CV</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="space-y-2.5">
          <div>
            <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">
              {effective === "inferred" ? "Inference" : effective === "conflicting" ? "What conflicts" : "Explanation"}
            </div>
            <p className="text-[13px] leading-relaxed text-ink-2">{item.explanation || "—"}</p>
          </div>
          {item.missingInfo && (
            <div>
              <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Missing information</div>
              <p className="text-[13px] leading-relaxed text-ink-2">{item.missingInfo}</p>
            </div>
          )}
        </div>
      </div>

      <div className="mt-3">
        {correcting ? (
          <CorrectionForm item={item} onDone={() => setCorrecting(false)} />
        ) : (
          <button type="button" onClick={() => setCorrecting(true)} className="text-[12.5px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
            {item.overrideResult ? "Change correction" : "Correct this"}
          </button>
        )}
        <CorrectionHistory item={item} label={(r) => RESULT_LABEL[r as AssessmentResult] ?? r} />
      </div>
    </div>
  );
}

function CorrectionForm({ item, onDone }: { item: ItemView; onDone: () => void }) {
  const [state, action, actionPending] = useServerForm(overrideItem.bind(null, item.id));
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) {
      toast({ message: "Correction saved" });
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <ActionForm action={action} pending={actionPending} className="grid gap-3 rounded-lg border border-line bg-[#fbfaf7] p-3 sm:grid-cols-[180px_1fr]">
      <Field label="Your assessment">
        <Select name="overrideResult" defaultValue={item.overrideResult ?? ""}>
          <option value="">Keep original ({RESULT_LABEL[item.result as AssessmentResult]})</option>
          {RESULTS.map((r) => (
            <option key={r} value={r}>{RESULT_LABEL[r]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Reason" hint="Job-related reasoning, e.g. what you verified in the resume or with the candidate.">
        <Textarea name="overrideNote" rows={2} defaultValue={item.overrideNote ?? ""} maxLength={2000} />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-2">
        <FormMessage state={state?.ok ? undefined : state} />
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>Cancel</Button>
          <SubmitButton size="sm" pendingLabel="Saving…">Save correction</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

export function ReviewControls({ assessmentId, reviewed, reviewedBy }: { assessmentId: string; reviewed: boolean; reviewedBy: string | null }) {
  if (reviewed) return <Badge tone="ok">Reviewed{reviewedBy ? ` by ${reviewedBy}` : ""}</Badge>;
  return (
    <ActionButton action={() => markReviewed(assessmentId)} variant="primary">
      Mark as reviewed
    </ActionButton>
  );
}

// ---------------------------------------------------------------- Recommendation

export type RecommendationView = {
  assessmentId: string;
  applicationId: string;
  openRequests: number;
  recommendation: string | null;
  rationale: string | null;
  criteriaCited: string[];
  questions: string[];
  adjustedNote: string | null;
  unavailable: string | null;
  status: string | null;
  finalRecommendation: string | null;
  note: string | null;
  reviewedBy: string | null;
};

export function RecommendationPanel({ r }: { r: RecommendationView }) {
  const [mode, setMode] = useState<"accept" | "edit" | "override" | null>(null);
  const [state, action, actionPending] = useServerForm(reviewRecommendation.bind(null, r.assessmentId));
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) {
      setMode(null);
      toast({ message: "Recommendation review saved" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  if (!r.recommendation) return <p className="text-[13px] text-muted">{r.unavailable ?? "No recommendation for this assessment."}</p>;
  const reviewed = r.status && r.status !== "pending";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <AiMark label="AI suggestion" />
        <span className={clsx("font-medium", reviewed && r.status === "overridden" && "line-through opacity-60")}>{RECOMMENDATION_LABEL[r.recommendation as Recommendation]}</span>
      </div>
      {r.rationale && <p className="text-[13px] leading-relaxed text-ink-2">{r.rationale}</p>}
      {r.criteriaCited.length > 0 && <p className="text-[12px] text-muted">Based on: {r.criteriaCited.join(" · ")}</p>}
      {r.questions.length > 0 && (
        <div>
          <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Questions to close gaps</div>
          <ul className="list-disc space-y-0.5 pl-5 text-[13px] text-ink-2">
            {r.questions.map((q, i) => (
              <li key={i}>{q}</li>
            ))}
          </ul>
        </div>
      )}
      {r.adjustedNote && <Notice tone="warn">{r.adjustedNote}</Notice>}
      {(r.finalRecommendation ?? r.recommendation) === "gather_more_info" && <InfoRequestFromRecommendation r={r} />}

      {reviewed ? (
        <div className="rounded-lg border border-line bg-sunken px-3 py-2 text-[13px]">
          <span className="font-medium">
            Recruiter {r.status === "accepted" ? "accepted" : r.status === "edited" ? "accepted with edits" : "overrode"}:
          </span>{" "}
          {RECOMMENDATION_LABEL[r.finalRecommendation as Recommendation]}
          <span className="text-muted"> · {r.reviewedBy}</span>
          {r.note && <p className="mt-0.5 text-ink-2">{r.note}</p>}
          <button type="button" onClick={() => setMode("override")} className="mt-1 block text-[12px] text-muted underline-offset-2 hover:text-ink hover:underline">
            Change
          </button>
        </div>
      ) : (
        !mode && (
          <div className="flex flex-wrap gap-2">
            <ActionForm action={action} pending={actionPending}>
              <input type="hidden" name="reviewAction" value="accept" />
              <SubmitButton size="sm" variant="primary" pendingLabel="Saving…">Accept</SubmitButton>
            </ActionForm>
            <Button size="sm" onClick={() => setMode("edit")}>Edit rationale</Button>
            <Button size="sm" onClick={() => setMode("override")}>Override</Button>
          </div>
        )
      )}
      {state?.error && <p className="text-[13px] text-danger">{state.error}</p>}
      {(mode === "edit" || mode === "override") && (
        <ActionForm action={action} pending={actionPending} className="space-y-3 rounded-lg border border-line bg-[#fbfaf7] p-3">
          <input type="hidden" name="reviewAction" value={mode} />
          {mode === "override" && (
            <Field label="Your recommendation">
              <Select name="finalRecommendation" defaultValue={r.finalRecommendation ?? r.recommendation}>
                {RECOMMENDATIONS.map((x) => (
                  <option key={x} value={x}>{RECOMMENDATION_LABEL[x]}</option>
                ))}
              </Select>
            </Field>
          )}
          <Field label={mode === "edit" ? "Your rationale" : "Reason"} hint="Job-related, based on the approved criteria.">
            <Textarea name="note" rows={2} defaultValue={r.note ?? (mode === "edit" ? r.rationale ?? "" : "")} maxLength={2000} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setMode(null)}>Cancel</Button>
            <SubmitButton size="sm" pendingLabel="Saving…">Save</SubmitButton>
          </div>
        </ActionForm>
      )}
    </div>
  );
}

/** Turns a "Gather more information" suggestion into a real queued task, in one step. */
function InfoRequestFromRecommendation({ r }: { r: RecommendationView }) {
  const [state, action, pending] = useServerForm(createInfoRequest.bind(null, r.applicationId));
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) toast({ message: "Information request added to your queue" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  if (r.openRequests > 0 || state?.ok)
    return <p className="text-[12.5px] text-muted">An information request is open for this candidate — see Information requests below.</p>;
  return (
    <ActionForm action={action} pending={pending} className="flex flex-wrap items-center gap-2 rounded-lg border border-line bg-[#fbfaf8] px-3 py-2">
      <input type="hidden" name="title" value="Gather more information" />
      <input type="hidden" name="questions" value={r.questions.join("\n")} />
      <input type="hidden" name="fromRecommendation" value="1" />
      <span className="text-[12.5px] text-ink-2">Turn these questions into a task in your queue?</span>
      <SubmitButton size="sm" variant="secondary" className="ml-auto" pendingLabel="Adding…">
        Create information request
      </SubmitButton>
      {state?.error && <p className="w-full text-[12.5px] text-danger">{state.error}</p>}
    </ActionForm>
  );
}

export function GeneratorTag({ generator, model }: { generator: string; model: string | null }) {
  if (generator === "ai")
    return (
      <span className="inline-flex items-center gap-1.5">
        <AiMark label="AI assessment" />
        {model && <span className="font-mono text-[11.5px] text-faint">{model}</span>}
      </span>
    );
  return <Badge>Keyword check · not AI</Badge>;
}

export function StaleNotice() {
  return <Notice tone="warn">The role&apos;s approved criteria changed after this assessment was created. Re-run it to assess against the current criteria.</Notice>;
}

// ---------------------------------------------------------------- Skills

/** One required or preferred skill: status, the excerpts behind it, and the recruiter's correction. */
export function SkillRow({ item }: { item: ItemView }) {
  const [open, setOpen] = useState(false);
  const [correcting, setCorrecting] = useState(false);
  const status = skillStatus(item.overrideResult ?? item.result);
  const original = skillStatus(item.result);
  return (
    <div className="px-4 py-2.5">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden className={clsx("shrink-0 text-faint transition-transform", open && "rotate-90")}>
            <path d="M3.5 2l3 3-3 3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
          </svg>
          <span className="font-medium">{item.criterionName}</span>
          <span className="truncate text-[12px] text-muted">
            {item.evidence.length ? `${item.evidence.length} excerpt${item.evidence.length === 1 ? "" : "s"}` : "no excerpt"}
          </span>
        </button>
        {item.overrideResult && original !== status && <SkillStatusBadge status={original} struck />}
        <SkillStatusBadge status={status} />
        {item.overrideResult && <span className="text-[11.5px] text-muted">corrected by {item.overriddenBy}</span>}
      </div>
      {open && (
        <div className="motion-fade mt-2 space-y-2 pl-4">
          {item.evidence.length === 0 ? (
            <p className="text-[12.5px] text-muted">
              No excerpt in the CV, candidate-provided information or linked source mentions this skill. That is missing evidence — not proof the candidate lacks it.
            </p>
          ) : (
            <ul className="space-y-1.5">
              {item.evidence.map((e, i) => (
                <li key={i} className={clsx("rounded-lg border-l-2 bg-[#fbfaf7] px-3 py-1.5", e.verified ? "border-ok" : "border-warn")}>
                  <p className="quote text-[13px] text-ink">“{e.quote}”</p>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[11.5px] text-muted">
                    <CitationButton evidence={e} />
                    {e.verified ? <span className="text-ok">✓ excerpt found in the source</span> : <span className="text-warn">⚠ excerpt not found verbatim — check the source</span>}
                  </div>
                </li>
              ))}
            </ul>
          )}
          {item.explanation && <p className="text-[12.5px] text-ink-2">{item.explanation}</p>}
          {item.missingInfo && <p className="text-[12.5px] text-muted">{item.missingInfo}</p>}
          {item.overrideResult && item.overrideNote && (
            <p className="rounded-md bg-sunken px-2.5 py-1.5 text-[12.5px]">
              <span className="font-medium">Recruiter note · {item.overriddenBy}:</span> {item.overrideNote}
            </p>
          )}
          {correcting ? (
            <SkillCorrectionForm item={item} onDone={() => setCorrecting(false)} />
          ) : (
            <button type="button" onClick={() => setCorrecting(true)} className="text-[12.5px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
              {item.overrideResult ? "Change correction" : "Correct this status"}
            </button>
          )}
          <CorrectionHistory item={item} label={(r) => SKILL_STATUS_LABEL[skillStatus(r)]} />
        </div>
      )}
    </div>
  );
}

function SkillCorrectionForm({ item, onDone }: { item: ItemView; onDone: () => void }) {
  const [state, action, actionPending] = useServerForm(overrideItem.bind(null, item.id));
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) {
      toast({ message: "Skill status corrected" });
      onDone();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <ActionForm action={action} pending={actionPending} className="grid gap-3 rounded-lg border border-line bg-[#fbfaf7] p-3 sm:grid-cols-[200px_1fr]">
      <Field label="Status">
        <Select name="overrideResult" defaultValue={item.overrideResult ?? ""}>
          <option value="">Keep original ({SKILL_STATUS_LABEL[skillStatus(item.result)]})</option>
          {Object.entries(SKILL_STATUS_RESULT).map(([st, r]) => (
            <option key={r} value={r}>
              {SKILL_STATUS_LABEL[st as keyof typeof SKILL_STATUS_RESULT]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Note" hint="What you checked — e.g. the project in the CV, or what the candidate told you. Required.">
        <Textarea name="overrideNote" rows={2} defaultValue={item.overrideNote ?? ""} maxLength={2000} />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-2">
        <FormMessage state={state?.ok ? undefined : state} />
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <SubmitButton size="sm" pendingLabel="Saving…">
            Save
          </SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

/** Who changed this item, from what to what, and when — with a way back to any earlier value. */
function CorrectionHistory({ item, label }: { item: ItemView; label: (result: string) => string }) {
  if (!item.corrections.length) return null;
  const show = (r: string | null) => (r ? label(r) : `${label(item.result)} (original)`);
  const current = item.overrideResult ?? null;
  return (
    <details className="mt-2 text-[12.5px]">
      <summary className="cursor-pointer text-muted hover:text-ink">Correction history ({item.corrections.length})</summary>
      <ol className="mt-1.5 space-y-1.5 border-l-2 border-line pl-3">
        {item.corrections.map((c) => (
          <li key={c.id}>
            <div>
              <span className="font-medium">{c.byName}</span>{" "}
              <span className="text-muted">
                {c.restored ? "restored" : "changed"} {show(c.fromResult)} → {show(c.toResult)} ·{" "}
                {new Date(c.createdAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </span>
            </div>
            {c.note && <p className="text-ink-2">{c.note}</p>}
            {(c.fromResult ?? null) !== current && (
              <ActionButton
                action={() => restoreCorrection(c.id, "before")}
                variant="ghost"
                confirm={`Restore “${show(c.fromResult)}”? This is recorded as a new change; nothing is deleted.`}
                successMessage="Earlier value restored"
              >
                Restore “{show(c.fromResult)}”
              </ActionButton>
            )}
          </li>
        ))}
      </ol>
    </details>
  );
}
