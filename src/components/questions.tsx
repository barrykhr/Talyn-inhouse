"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { setQuestionStatus, editQuestion } from "@/server/question-actions";
import { ActionButton, ActionForm, SubmitButton, useServerForm } from "./client";
import { AiMark, Button, Textarea } from "./ui";

export type QuestionView = {
  id: string;
  text: string;
  criterionName: string;
  rationale: string;
  evidence: { gap?: string; quote?: string; page?: number | null };
  origin: string;
  status: string;
};

/** Reviewable question list. Questions are for the recruiter to ask; Talyn never sends them. */
export function QuestionList({ questions, readOnly = false }: { questions: QuestionView[]; readOnly?: boolean }) {
  if (!questions.length) return <p className="text-[13px] text-faint">None yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {questions.map((q) => (
        <QuestionRow key={q.id} q={q} readOnly={readOnly} />
      ))}
    </ul>
  );
}

function QuestionRow({ q, readOnly }: { q: QuestionView; readOnly: boolean }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useServerForm(editQuestion.bind(null, q.id));
  useEffect(() => {
    if (state?.ok) setEditing(false);
  }, [state]);
  return (
    <li className={clsx("py-2.5", q.status === "rejected" && "opacity-50")}>
      {editing ? (
        <ActionForm action={action} pending={pending} className="space-y-2">
          <Textarea name="text" defaultValue={q.text} rows={2} maxLength={500} />
          <div className="flex justify-end gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
            <SubmitButton size="sm" pendingLabel="Saving…">
              Save and approve
            </SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <div className="text-[13.5px] text-ink">{q.text}</div>
      )}
      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px] text-muted">
        <span className="font-medium text-ink-2">{q.criterionName}</span>
        {q.origin === "ai" ? <AiMark label="AI" /> : q.origin === "template" ? <span className="text-faint">template</span> : <span className="text-faint">recruiter</span>}
        {q.rationale && <span>· {q.rationale}</span>}
      </div>
      {(q.evidence.quote || q.evidence.gap) && (
        <div className="mt-1 text-[12px]">
          {q.evidence.quote ? (
            <span className="quote text-ink-2">
              “{q.evidence.quote}”{q.evidence.page ? ` — CV p.${q.evidence.page}` : ""}
            </span>
          ) : (
            <span className="text-muted">Gap: {q.evidence.gap}</span>
          )}
        </div>
      )}
      {!readOnly && !editing && (
        <div className="mt-1.5 flex gap-1">
          {q.status !== "approved" && (
            <ActionButton action={() => setQuestionStatus(q.id, "approved")} variant="secondary">
              Approve
            </ActionButton>
          )}
          {q.status !== "rejected" && (
            <ActionButton action={() => setQuestionStatus(q.id, "rejected")} variant="ghost">
              Reject
            </ActionButton>
          )}
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        </div>
      )}
    </li>
  );
}
