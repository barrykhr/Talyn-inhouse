"use client";

import clsx from "clsx";
import { useActionState, useEffect, useState, useTransition } from "react";
import { ActionButton, FormMessage, Spinner, SubmitButton } from "@/components/client";
import { AiMark, Badge, Button, Field, Notice, Select, Textarea } from "@/components/ui";
import { RESULT_HELP, RESULT_LABEL, RESULTS, type AssessmentResult, type Evidence } from "@/lib/domain";
import { markReviewed, overrideItem, runAssessment } from "@/server/assessment-actions";
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

const resultTone: Record<string, "ok" | "warn" | "gap"> = { supported: "ok", inferred: "warn", not_stated: "gap" };

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
  const [pending, start] = useTransition();
  const [mode, setMode] = useState<"ai" | "keyword" | null>(null);
  const [state, setState] = useState<ActionState>(undefined);
  const run = (m: "ai" | "keyword") => {
    if (hasAssessment && !window.confirm("Create a new assessment? The current one stays in history.")) return;
    setMode(m);
    setState(undefined);
    start(async () => setState(await runAssessment(applicationId, m)));
  };
  return (
    <div>
      <div className="flex flex-wrap gap-2">
        <Button
          variant="signal"
          disabled={pending || !aiConfigured || !!disabledReason}
          onClick={() => run("ai")}
          title={aiConfigured ? "AI reads the resume against each approved criterion and cites evidence" : "Add an AI API key in Settings to enable"}
        >
          {pending && mode === "ai" && <Spinner />}
          {pending && mode === "ai" ? "Assessing…" : hasAssessment ? "Re-assess with AI" : "Assess with AI"}
        </Button>
        <Button variant="secondary" disabled={pending || !!disabledReason} onClick={() => run("keyword")} title="Finds resume lines containing criterion keywords. Not AI.">
          {pending && mode === "keyword" && <Spinner />}Keyword check (no AI)
        </Button>
      </div>
      {disabledReason && <p className="mt-2 text-[13px] text-warn">{disabledReason}</p>}
      {!aiConfigured && !disabledReason && (
        <p className="mt-2 text-[12.5px] text-muted">AI assessment is off. Set <code className="font-mono">OPENAI_API_KEY</code> or <code className="font-mono">ANTHROPIC_API_KEY</code> to enable it.</p>
      )}
      {state?.error && <p className="mt-2 text-[13px] text-danger">{state.error}</p>}
    </div>
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
                    <a href={e.source === "resume" ? (e.page ? `#resume-p${e.page}` : "#resume") : "#candidate-info"} className="underline-offset-2 hover:text-ink hover:underline">
                      {e.source === "resume" ? "Resume" : "Candidate-provided info"}
                      {e.page ? ` · p.${e.page}` : ""}
                      {e.section && e.source === "resume" ? ` · ${e.section}` : ""}
                    </a>
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
            <div className="mb-1 text-[11.5px] font-semibold uppercase tracking-wide text-muted">{effective === "inferred" ? "Inference" : "Explanation"}</div>
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
  const [state, action] = useActionState(overrideItem.bind(null, item.id), undefined);
  useEffect(() => {
    if (state?.ok) onDone();
  }, [state, onDone]);
  return (
    <form action={action} className="grid gap-3 rounded-lg border border-line bg-[#fbfaf7] p-3 sm:grid-cols-[180px_1fr]">
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
    </form>
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

export function GeneratorTag({ generator, model }: { generator: string; model: string | null }) {
  if (generator === "ai") return <span className="inline-flex items-center gap-1.5"><AiMark label="AI assessment" />{model && <span className="font-mono text-[11.5px] text-faint">{model}</span>}</span>;
  return <Badge>Keyword check · not AI</Badge>;
}

export function StaleNotice() {
  return <Notice tone="warn">The role&apos;s approved criteria changed after this assessment was created. Re-run it to assess against the current criteria.</Notice>;
}
