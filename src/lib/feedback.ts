// Hiring team feedback on shortlisted candidates. Advisory: never a decision.
export const FEEDBACK_VERDICTS = ["interested", "not_a_fit", "question"] as const;
export type FeedbackVerdict = (typeof FEEDBACK_VERDICTS)[number];
export const FEEDBACK_LABEL: Record<FeedbackVerdict, string> = { interested: "Interested", not_a_fit: "Not a fit", question: "Question" };

/** Counts per verdict, for a one-line summary ("2 interested · 1 question"). */
export function feedbackSummary(rows: { verdict: string }[]): string {
  const n = (v: FeedbackVerdict) => rows.filter((r) => r.verdict === v).length;
  const parts = [n("interested") && `${n("interested")} interested`, n("not_a_fit") && `${n("not_a_fit")} not a fit`, n("question") && `${n("question")} question${n("question") === 1 ? "" : "s"}`].filter(Boolean);
  return parts.length ? parts.join(" · ") : "No feedback yet";
}
