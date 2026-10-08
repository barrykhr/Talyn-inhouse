"use client";

import { useEffect, useState } from "react";
import { ActionButton, ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { useToast } from "@/components/toast";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { createInfoRequest, resolveTask } from "@/server/task-actions";

export type TaskView = { id: string; title: string; questions: string[]; dueAt: string | null; createdByName: string; createdAt: string };

/** Open information requests for this application. Resolving one never records a decision. */
export function TasksCard({ applicationId, tasks, suggested }: { applicationId: string; tasks: TaskView[]; suggested: string[] }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const [state, action, pending] = useServerForm(createInfoRequest.bind(null, applicationId));
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) {
      toast({ message: "Information request added to your queue" });
      setOpen(false);
      setKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <div className="space-y-3">
      {tasks.length === 0 && !open && <p className="text-[13px] text-muted">No open information requests.</p>}
      {tasks.map((t) => (
        <div key={t.id} className="rounded-lg border border-line bg-[#fbfaf8] p-3">
          <div className="text-[13px] font-medium">{t.title}</div>
          {t.questions.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-ink-2">
              {t.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}
          <div className="mt-2 flex flex-wrap items-center gap-1 text-[11.5px] text-faint">
            <span>
              {t.createdByName} · {new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
            </span>
            <span className="ml-auto flex gap-1">
              <ActionButton action={() => resolveTask(t.id, "done")} variant="secondary" successMessage="Marked done — no decision was recorded">
                Done
              </ActionButton>
              <ActionButton action={() => resolveTask(t.id, "cancelled")} variant="ghost" successMessage="Request cancelled">
                Cancel
              </ActionButton>
            </span>
          </div>
        </div>
      ))}
      {open ? (
        <ActionForm key={key} action={action} pending={pending} className="space-y-2.5 rounded-lg border border-line p-3">
          <Field label="Title">
            <Input name="title" defaultValue="Gather more information" maxLength={200} />
          </Field>
          <Field label="Questions" hint="One per line. Job-related only.">
            <Textarea name="questions" rows={4} defaultValue={suggested.join("\n")} maxLength={4000} />
          </Field>
          <Field label="Due (optional)">
            <Input name="dueAt" type="date" />
          </Field>
          <div className="flex items-center gap-2">
            <FormMessage state={state?.ok ? undefined : state} />
            <div className="ml-auto flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="sm" pendingLabel="Saving…">
                Add to queue
              </SubmitButton>
            </div>
          </div>
        </ActionForm>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          Request more information
        </Button>
      )}
    </div>
  );
}
