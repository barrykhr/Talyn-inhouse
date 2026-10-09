"use client";

import clsx from "clsx";
import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Card, Textarea } from "@/components/ui";
import { RATING_LABEL, RATING_LEVELS, type Anchors, type ScoreEntry } from "@/lib/interviews/rubric";
import { saveScorecard } from "@/server/interview-actions";

export type ScorecardCompetency = {
  id: string;
  name: string;
  description: string;
  anchors: Anchors;
  questions: { id: string; text: string; followUps: string; guidance: string }[];
};

/** The interviewer's own scorecard. Ratings use the shared rubric; every rating needs evidence. */
export function ScorecardForm({
  assignmentId,
  competencies,
  entries,
  questionNotes,
  notes,
  readOnly,
}: {
  assignmentId: string;
  competencies: ScorecardCompetency[];
  entries: ScoreEntry[];
  questionNotes: Record<string, string>;
  notes: string;
  readOnly: boolean;
}) {
  const [state, action, pending] = useServerForm(saveScorecard.bind(null, assignmentId));
  const byId = new Map(entries.map((e) => [e.competencyId, e]));
  const [ratings, setRatings] = useState<Record<string, string>>(
    Object.fromEntries(competencies.map((c) => [c.id, byId.get(c.id)?.notAssessed ? "na" : String(byId.get(c.id)?.rating ?? "")])),
  );
  const done = competencies.filter((c) => ratings[c.id]).length;

  return (
    <ActionForm action={action} pending={pending} className="space-y-4">
      {competencies.map((c, i) => {
        const r = ratings[c.id];
        return (
          <Card key={c.id} className="overflow-hidden">
            <div className="border-b border-line bg-[#fbfaf8] px-4 py-3">
              <h2 className="font-medium">
                <span className="text-faint">{i + 1}.</span> {c.name}
              </h2>
              {c.description && <p className="text-[12.5px] text-muted">{c.description}</p>}
            </div>
            {c.questions.length > 0 && (
              <ol className="divide-y divide-line">
                {c.questions.map((q) => (
                  <li key={q.id} className="px-4 py-3">
                    <p className="text-[13.5px] font-medium">{q.text}</p>
                    {q.followUps && <p className="mt-0.5 whitespace-pre-line text-[12.5px] text-ink-2">Follow-ups: {q.followUps.split("\n").filter(Boolean).join(" · ")}</p>}
                    {q.guidance && <p className="mt-0.5 text-[12px] text-muted">Look for: {q.guidance}</p>}
                    <label className="sr-only" htmlFor={`qnote_${q.id}`}>
                      Notes for this question
                    </label>
                    <Textarea id={`qnote_${q.id}`} name={`qnote_${q.id}`} defaultValue={questionNotes[q.id] ?? ""} rows={2} maxLength={2000} disabled={readOnly} placeholder="What they said — facts and examples, not impressions" className="mt-2" />
                  </li>
                ))}
              </ol>
            )}
            <fieldset className="border-t border-line px-4 py-3" disabled={readOnly}>
              <legend className="mb-2 text-[13px] font-medium">Rating for “{c.name}”</legend>
              <div className="grid gap-1.5 md:grid-cols-5" role="radiogroup">
                {RATING_LEVELS.map((l) => (
                  <label key={l} className={clsx("flex cursor-pointer flex-col rounded-lg border p-2 text-[12px]", r === String(l) ? "border-ink bg-ink text-white" : "border-line-strong hover:bg-sunken")}>
                    <span className="flex items-center gap-1.5 font-semibold">
                      <input type="radio" name={`rating_${c.id}`} value={l} checked={r === String(l)} onChange={() => setRatings({ ...ratings, [c.id]: String(l) })} className="sr-only" />
                      {l} · {RATING_LABEL[l]}
                    </span>
                    <span className={clsx("mt-0.5", r === String(l) ? "text-white/80" : "text-muted")}>{c.anchors[String(l) as keyof Anchors]}</span>
                  </label>
                ))}
                <label className={clsx("flex cursor-pointer flex-col rounded-lg border border-dashed p-2 text-[12px]", r === "na" ? "border-ink bg-sunken" : "border-line-strong hover:bg-sunken")}>
                  <span className="flex items-center gap-1.5 font-semibold">
                    <input type="radio" name={`rating_${c.id}`} value="na" checked={r === "na"} onChange={() => setRatings({ ...ratings, [c.id]: "na" })} className="sr-only" />
                    Not assessed
                  </span>
                  <span className="mt-0.5 text-muted">Didn&apos;t come up or ran out of time. Not a low rating.</span>
                </label>
              </div>
              <label htmlFor={`evidence_${c.id}`} className="mt-3 block text-[12.5px] font-medium">
                Evidence for this rating {r && r !== "na" ? <span className="text-danger">(required)</span> : <span className="font-normal text-muted">(optional if not assessed)</span>}
              </label>
              <Textarea
                id={`evidence_${c.id}`}
                name={`evidence_${c.id}`}
                defaultValue={byId.get(c.id)?.evidence ?? ""}
                rows={3}
                maxLength={4000}
                placeholder="Specific examples the candidate gave, and how they relate to the anchors above"
              />
            </fieldset>
          </Card>
        );
      })}

      <Card className="p-4">
        <label htmlFor="sc-notes" className="text-[13px] font-medium">
          Other notes (optional)
        </label>
        <p className="mb-1.5 text-[12px] text-muted">Job-relevant observations only. Don&apos;t record appearance, accent, age, family, health or other personal characteristics.</p>
        <Textarea id="sc-notes" name="notes" defaultValue={notes} rows={3} maxLength={4000} disabled={readOnly} />
      </Card>

      {!readOnly && (
        <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
          <span className="text-[12.5px] text-muted">
            {done} of {competencies.length} rated or marked not assessed · drafts are private to you
          </span>
          <FormMessage state={state} />
          <div className="ml-auto flex gap-2">
            <SubmitButton name="intent" value="save" variant="secondary" pendingLabel="Saving…">
              Save draft
            </SubmitButton>
            <SubmitButton name="intent" value="submit" pendingLabel="Submitting…">
              Submit scorecard
            </SubmitButton>
          </div>
        </div>
      )}
    </ActionForm>
  );
}
