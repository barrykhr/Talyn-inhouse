"use client";

import clsx from "clsx";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { buttonClass } from "@/components/ui";
import { FEEDBACK_LABEL, FEEDBACK_VERDICTS, type FeedbackVerdict } from "@/lib/feedback";
import { recordHiringFeedback } from "@/server/feedback-actions";

/** Interested / Not a fit / Question, with a note. Goes to the recruiter; never changes the stage or decision. */
export function FeedbackForm({ applicationId, mine }: { applicationId: string; mine: { verdict: string; comment: string } | null }) {
  const [verdict, setVerdict] = useState<FeedbackVerdict | null>((mine?.verdict as FeedbackVerdict) ?? null);
  const [comment, setComment] = useState(mine?.comment ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const needsNote = verdict === "not_a_fit" || verdict === "question";
  const submit = async () => {
    if (!verdict) return;
    setBusy(true);
    setError(null);
    try {
      const r = await recordHiringFeedback(applicationId, verdict, comment);
      if (r?.error) setError(r.error);
      else {
        toast({ message: r?.message ?? "Feedback sent" });
        router.refresh();
      }
    } catch {
      setError("Couldn't send it. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2">
      <div role="radiogroup" aria-label="Your view" className="flex flex-wrap gap-1.5">
        {FEEDBACK_VERDICTS.map((v) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={verdict === v}
            onClick={() => setVerdict(v)}
            className={clsx("h-8 rounded-md border px-3 text-[13px] font-medium", verdict === v ? "border-ink bg-ink text-white" : "border-line-strong bg-surface hover:bg-sunken")}
          >
            {FEEDBACK_LABEL[v]}
          </button>
        ))}
      </div>
      {verdict && (
        <>
          <textarea
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={2}
            maxLength={2000}
            aria-label={needsNote ? "Reason or question (required)" : "Note (optional)"}
            placeholder={verdict === "question" ? "What would you like the recruiter to find out?" : verdict === "not_a_fit" ? "What's missing for this role?" : "Anything to probe in the interview? (optional)"}
            className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[13px] focus:border-ink focus:outline-none"
          />
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className={buttonClass("primary", "sm")} disabled={busy || (needsNote && !comment.trim())} onClick={submit}>
              {busy ? "Sending…" : mine ? "Update feedback" : "Send to recruiter"}
            </button>
            {error && (
              <span role="alert" className="text-[12px] text-danger">
                {error}
              </span>
            )}
          </div>
        </>
      )}
    </div>
  );
}
