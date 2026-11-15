"use client";

import { useEffect, useState, type ReactNode } from "react";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { useToast } from "@/components/toast";
import { Field, Select, Textarea } from "@/components/ui";
import { DECISIONS, DECISION_LABEL, REJECT_REASONS, STAGE_LABEL, type Stage } from "@/lib/domain";
import { recordDecision } from "@/server/candidate-actions";

/**
 * The recruiter's decision: Shortlist, Hold or Reject. The three options are deliberately identical
 * in size, weight and motion so none is visually suggested, and none is pre-selected by the AI.
 * Reject requires a job-related reason. Moving the pipeline stage is a separate, visible choice in
 * the same step: ticked by default for Reject (to Rejected), unticked for Shortlist.
 */
export function DecisionForm({
  applicationId,
  decision,
  note,
  reason,
  stage,
  compact = false,
  summary,
}: {
  applicationId: string;
  decision: string | null;
  note: string | null;
  reason: string | null;
  stage: string;
  /** Sticky-bar layout: options in one row; reason, stage tick box and note appear once an option is chosen. */
  compact?: boolean;
  /** Shown next to the options in the bar, e.g. who recorded the current decision. */
  summary?: ReactNode;
}) {
  const [state, action, actionPending] = useServerForm(recordDecision.bind(null, applicationId));
  const [choice, setChoice] = useState(decision ?? "");
  const [editing, setEditing] = useState(false);
  // In the bar, the details open when the recruiter picks a different option or asks to edit.
  const expanded = !compact || editing || choice !== (decision ?? "");
  const toast = useToast();
  // The stage move offered with this decision, if any (never applied unless the box is ticked).
  const move: { to: Stage; checked: boolean } | null =
    choice === "decline" && stage !== "rejected"
      ? { to: "rejected", checked: true }
      : choice === "advance" && (stage === "new" || stage === "in_review")
        ? { to: "recruiter_screen", checked: false }
        : null;
  useEffect(() => {
    if (state?.ok) {
      toast({ message: state.message ?? "Decision recorded." });
      setEditing(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <ActionForm action={action} pending={actionPending} className={compact ? "space-y-2" : "space-y-3"}>
      <div className={compact ? "flex flex-wrap items-center gap-x-3 gap-y-2" : undefined}>
      <fieldset className={compact ? "w-full sm:w-auto" : undefined}>
        <legend className="sr-only">Decision</legend>
        <div className={compact ? "grid grid-cols-3 gap-1.5 sm:w-[330px]" : "grid grid-cols-3 gap-1.5"}>
          {DECISIONS.map((d) => (
            <label key={d} className="cursor-pointer">
              <input type="radio" name="decision" value={d} checked={choice === d} onChange={() => setChoice(d)} className="peer sr-only" />
              <span className="flex h-9 items-center justify-center rounded-lg border border-line-strong bg-surface text-[13px] font-medium text-ink-2 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-signal">
                {DECISION_LABEL[d]}
              </span>
            </label>
          ))}
        </div>
      </fieldset>
      {compact && summary && <div className="min-w-0 text-[12px] text-muted">{summary}</div>}
      {compact && !expanded && decision && (
        <button type="button" onClick={() => setEditing(true)} className="text-[12px] font-medium text-muted underline-offset-2 hover:text-ink hover:underline">
          Edit reason or note
        </button>
      )}
      </div>
      {expanded && (
      <div className={compact ? "motion-fade grid gap-2 rounded-lg border border-line bg-surface p-3 sm:grid-cols-2" : "space-y-3"}>
      {choice === "decline" && (
        <Field label="Reason for rejecting" hint="Required. Job-related, tied to the criteria.">
          <Select name="decisionReason" defaultValue={reason ?? ""} required>
            <option value="">Choose a reason…</option>
            {REJECT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </Select>
        </Field>
      )}
      {move && (
        <label key={`${choice}-${move.to}`} className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" name="moveStage" value={move.to} defaultChecked={move.checked} className="mt-0.5" />
          <span>
            Also move to <strong className="font-medium">{STAGE_LABEL[move.to]}</strong>
            <span className="block text-[12px] text-muted">Currently {STAGE_LABEL[stage as Stage] ?? stage}. Untick to record the decision only.</span>
          </span>
        </label>
      )}
      <Field label="Note" hint={choice === "decline" ? "Required if the reason is Other." : "Optional."}>
        <Textarea name="decisionNote" rows={2} defaultValue={note ?? ""} maxLength={4000} />
      </Field>
      <div className={compact ? "flex items-center gap-3 sm:col-span-2" : "flex items-center gap-3"}>
        <FormMessage state={state?.ok ? undefined : state} />
        {compact && (
          <button
            type="button"
            className="ml-auto text-[12.5px] text-muted hover:text-ink"
            onClick={() => {
              setChoice(decision ?? "");
              setEditing(false);
            }}
          >
            Cancel
          </button>
        )}
        <SubmitButton size="sm" className={compact ? undefined : "ml-auto"} pendingLabel="Saving…" disabled={!choice}>
          Record decision
        </SubmitButton>
      </div>
      </div>
      )}
    </ActionForm>
  );
}
