"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/client";
import { Field, Textarea } from "@/components/ui";
import { DECISIONS, DECISION_LABEL } from "@/lib/domain";
import { recordDecision } from "@/server/candidate-actions";

export function DecisionForm({ applicationId, decision, note }: { applicationId: string; decision: string | null; note: string | null }) {
  const [state, action] = useActionState(recordDecision.bind(null, applicationId), undefined);
  return (
    <form action={action} className="space-y-3">
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Decision">
        {DECISIONS.map((d) => (
          <label key={d} className="cursor-pointer">
            <input type="radio" name="decision" value={d} defaultChecked={decision === d} className="peer sr-only" />
            <span className="inline-flex h-8 items-center rounded-lg border border-line-strong bg-surface px-3 text-[13px] font-medium text-ink-2 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-signal">
              {DECISION_LABEL[d]}
            </span>
          </label>
        ))}
      </div>
      <Field label="Rationale" hint="Required when declining. Keep it job-related and tied to the criteria.">
        <Textarea name="decisionNote" rows={2} defaultValue={note ?? ""} maxLength={4000} />
      </Field>
      <div className="flex items-center gap-3">
        <FormMessage state={state} />
        <SubmitButton size="sm" className="ml-auto" pendingLabel="Saving…">Record decision</SubmitButton>
      </div>
    </form>
  );
}
