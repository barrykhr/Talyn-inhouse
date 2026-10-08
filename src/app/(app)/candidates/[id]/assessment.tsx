"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { ActionForm, ActionButton, FormMessage, Spinner, SubmitButton, useServerForm } from "@/components/client";
import { AiMark, Badge, Button, Field, Notice, Select, Textarea } from "@/components/ui";
import { RECOMMENDATIONS, RECOMMENDATION_LABEL, RESULT_HELP, RESULT_LABEL, RESULTS, type AssessmentResult, type Evidence, type Recommendation } from "@/lib/domain";
import { useSourceViewer } from "@/components/source-viewer";
import { StagedProgress } from "@/components/staged-progress";
import { useToast } from "@/components/toast";
import { markReviewed, overrideItem, reviewRecommendation, runAssessment } from "@/server/assessment-actions";
import type { ActionState } from "@/server/form";

export type ItemView = {
  id: string;
  criterionName: string;
  importance: string;
  result: string;
  evidence: Evidence[];
  explanation: string;
  missingInfo: string;
  confidence: string | null;
  overrideResult: string | null;
  overrideNote: string | null;
  overriddenBy: string | null;
  overriddenAt: string | null;
};

const resultTone: Record<string, "ok" | "warn" | "gap" | "danger"> = {
  supported: "ok",
  partially_supported: "warn",
  inferred: "warn",
  conflicting: "danger",
  not_stated: "gap",
};

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
  const label = `${e.source === "resume" ? "CV" : "Candidate-provided info"}${e.page ? ` · p.${e.page}` : ""}${e.section && e.source === "resume" ? ` · ${e.section}` : ""}`;
  if (!openSource || !e.verified) return <span>{label}</span>;
  return (
    <button
      type="button"
      onClick={() => openSource({ source: e.source, page: e.page, quote: e.quote, label })}
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
            <span className="text-[12px] text-muted">{item.importance === "essential" ? "Essential" : "Preferred"}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
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
                      <span className="text-ok">✓ found in source</span>
                    ) : (
                      <span className="text-warn" title="This text could not be found verbatim in the candidate's material">⚠ not found verbatim — verify</span>
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
