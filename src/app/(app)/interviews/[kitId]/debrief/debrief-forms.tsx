"use client";

import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Field, Textarea } from "@/components/ui";
import { DECISIONS, DECISION_LABEL } from "@/lib/interviews/rubric";
import { addDebriefComment, recordInterviewDecision } from "@/server/interview-actions";

export function CommentForm({ kitId }: { kitId: string }) {
  const [state, action, pending] = useServerForm(addDebriefComment.bind(null, kitId));
  const [key, setKey] = useState(0);
  return (
    <ActionForm
      action={async (fd) => {
        await action(fd);
        setKey((k) => k + 1);
      }}
      pending={pending}
      className="space-y-2"
    >
      <Textarea key={key} name="body" rows={3} maxLength={4000} required placeholder="Discuss the evidence for the role's criteria — what supports or contradicts each rating?" aria-label="Debrief comment" />
      <div className="flex items-center gap-2">
        <FormMessage state={state?.ok ? undefined : state} />
        <SubmitButton size="sm" className="ml-auto" variant="secondary" pendingLabel="Posting…">
          Add comment
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Advance / Hold / Decline, equal weight, nothing pre-selected. Saved only by a person. */
export function DecisionForm({ kitId, current, rationale, pending: pendingCount }: { kitId: string; current: string | null; rationale: string | null; pending: number }) {
  const [state, action, pending] = useServerForm(recordInterviewDecision.bind(null, kitId));
  const [choice, setChoice] = useState(current ?? "");
  return (
    <ActionForm action={action} pending={pending} className="space-y-3">
      <fieldset>
        <legend className="sr-only">Team decision</legend>
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
      <Field label="Rationale" hint="Required. Tie it to the evidence on the role's criteria, not to the candidate as a person.">
        <Textarea name="rationale" rows={3} maxLength={4000} defaultValue={rationale ?? ""} required />
      </Field>
      {pendingCount > 0 && <p className="text-[12px] text-warn">{pendingCount} scorecard{pendingCount === 1 ? " is" : "s are"} not submitted yet. You can still decide, but their evidence won&apos;t be included.</p>}
      <div className="flex items-center gap-2">
        <FormMessage state={state} />
        <SubmitButton size="sm" className="ml-auto" pendingLabel="Recording…">
          {current ? "Update decision" : "Record decision"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
