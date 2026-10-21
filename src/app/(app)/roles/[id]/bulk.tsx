"use client";

import { useEffect, useState } from "react";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { REJECT_REASONS } from "@/lib/domain";
import { bulkDecision } from "@/server/review-actions";

export const BULK_FORM_ID = "bulk-decisions";
const boxes = () => Array.from(document.querySelectorAll<HTMLInputElement>(`input[form="${BULK_FORM_ID}"][name="ids"]`));

/** A row's selection checkbox; it belongs to the bulk form wherever the row renders. */
export function BulkCheckbox({ applicationId, name }: { applicationId: string; name: string }) {
  return <input type="checkbox" form={BULK_FORM_ID} name="ids" value={applicationId} aria-label={`Select ${name}`} className="mt-1 h-4 w-4 lg:mt-0" />;
}

/**
 * Bulk Shortlist / Hold / Reject for the applicants the recruiter ticked. Nothing is pre-selected;
 * Reject asks once for a job-related reason, and the stage moves only if the recruiter leaves
 * "Also move to the Rejected stage" ticked.
 */
export function BulkDecisions() {
  const [state, action, pending] = useServerForm(bulkDecision);
  const [count, setCount] = useState(0);
  const [total, setTotal] = useState(0);
  const [decision, setDecision] = useState("");
  const [reason, setReason] = useState("");

  useEffect(() => {
    const update = () => {
      const all = boxes();
      setTotal(all.length);
      setCount(all.filter((b) => b.checked).length);
    };
    update();
    document.addEventListener("change", update);
    return () => document.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!state?.ok) return;
    boxes().forEach((b) => (b.checked = false));
    setCount(0);
    setDecision("");
    setReason("");
  }, [state]);

  const toggleAll = (on: boolean) => {
    boxes().forEach((b) => (b.checked = on));
    setCount(on ? boxes().length : 0);
  };

  return (
    <ActionForm id={BULK_FORM_ID} action={action} pending={pending} className="mb-3 rounded-xl border border-line bg-surface px-3 py-2.5 text-[13px]">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <label className="flex items-center gap-1.5">
          <input type="checkbox" checked={total > 0 && count === total} onChange={(e) => toggleAll(e.target.checked)} aria-label="Select all applicants on this page" />
          <span className="text-muted">{count ? `${count} selected` : "Select applicants to decide in bulk"}</span>
        </label>
        {count > 0 && (
          <>
            <div role="radiogroup" aria-label="Decision for the selected applicants" className="flex gap-1">
              {[
                ["advance", "Shortlist"],
                ["hold", "Hold"],
                ["decline", "Reject"],
              ].map(([v, label]) => (
                <label key={v} className="cursor-pointer">
                  <input type="radio" name="decision" value={v} checked={decision === v} onChange={() => setDecision(v)} className="peer sr-only" />
                  <span className="inline-flex h-7 items-center rounded-md border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium text-ink-2 peer-checked:border-ink peer-checked:bg-ink peer-checked:text-white peer-focus-visible:outline-2 peer-focus-visible:outline-signal">
                    {label}
                  </span>
                </label>
              ))}
            </div>
            {decision === "decline" && (
              <>
                <select name="reason" value={reason} onChange={(e) => setReason(e.target.value)} aria-label="Reason for rejecting" className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12.5px]">
                  <option value="">Job-related reason…</option>
                  {REJECT_REASONS.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
                <input name="note" placeholder={reason === "other" ? "Note (required)" : "Note (optional)"} maxLength={4000} className="h-7 w-44 rounded-md border border-line-strong px-2 text-[12.5px]" aria-label="Note" />
                <label className="flex items-center gap-1.5 text-[12.5px]">
                  <input type="checkbox" name="moveStage" value="rejected" defaultChecked />
                  Also move to the Rejected stage
                </label>
              </>
            )}
            <SubmitButton size="sm" pendingLabel="Saving…" disabled={!decision || (decision === "decline" && !reason)}>
              Apply to {count}
            </SubmitButton>
          </>
        )}
        <FormMessage state={state} />
      </div>
      <p className="mt-1 text-[11.5px] text-faint">Each decision is yours and is recorded per applicant. Talyn never decides in bulk on its own.</p>
    </ActionForm>
  );
}
