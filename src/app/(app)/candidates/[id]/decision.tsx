"use client";

import { useEffect, useState } from "react";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { useToast } from "@/components/toast";
import { Field, Select, Textarea } from "@/components/ui";
import { DECISIONS, DECISION_LABEL, REJECT_REASONS } from "@/lib/domain";
import { recordDecision } from "@/server/candidate-actions";

/**
 * The recruiter's decision: Shortlist, Hold or Reject. The three options are deliberately identical
 * in size, weight and motion so none is visually suggested, and none is pre-selected by the AI.
 * Reject requires a job-related reason.
 */
export function DecisionForm({ applicationId, decision, note, reason }: { applicationId: string; decision: string | null; note: string | null; reason: string | null }) {
  const [state, action, actionPending] = useServerForm(recordDecision.bind(null, applicationId));
  const [choice, setChoice] = useState(decision ?? "");
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) toast({ message: "Decision recorded. The pipeline stage is unchanged until you move it." });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <ActionForm action={action} pending={actionPending} className="space-y-3">
      <fieldset>
        <legend className="sr-only">Decision</legend>
        <div className="grid grid-cols-3 gap-1.5">
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
      <Field label="Note" hint={choice === "decline" ? "Required if the reason is Other." : "Optional."}>
        <Textarea name="decisionNote" rows={2} defaultValue={note ?? ""} maxLength={4000} />
      </Field>
      <div className="flex items-center gap-3">
        <FormMessage state={state?.ok ? undefined : state} />
        <SubmitButton size="sm" className="ml-auto" pendingLabel="Saving…">
          Record decision
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
