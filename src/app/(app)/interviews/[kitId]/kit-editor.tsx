"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionButton, ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { useToast } from "@/components/toast";
import { AiMark, Badge, Button, Card, Field, Input, Select, Textarea } from "@/components/ui";
import { RATING_LABEL, RATING_LEVELS, type Anchors } from "@/lib/interviews/rubric";
import {
  addCompetency,
  addQuestion,
  assignInterviewer,
  moveCompetency,
  moveQuestion,
  removeCompetency,
  removeQuestion,
  removeStage,
  setHiringManager,
  unassignInterviewer,
  updateCompetency,
  updateQuestion,
  updateStage,
} from "@/server/interview-actions";

export type QuestionView = { id: string; text: string; followUps: string; guidance: string; origin: string; edited: boolean };
export type CompetencyView = { id: string; name: string; description: string; importance: string; origin: string; anchorsOrigin: string; anchors: Anchors; questions: QuestionView[] };
export type StageView = {
  id: string;
  name: string;
  purpose: string;
  competencyIds: string[];
  scheduledAt: string | null;
  durationMins: number | null;
  locationNote: string | null;
  assignments: { id: string; interviewerId: string; interviewerName: string; status: string; submittedAt: string | null }[];
};
export type Member = { userId: string; name: string; role: string };

const Q_ORIGIN: Record<string, string> = { ai: "AI-drafted", template: "Template", core_question: "Role core question", recruiter: "Added by recruiter" };
const STATUS: Record<string, string> = { not_started: "Not started", draft: "Draft (private)", submitted: "Submitted" };

function useOkToast(state: { ok?: boolean; message?: string } | undefined, after?: () => void) {
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) {
      if (state.message) toast({ message: state.message });
      after?.();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
}

function OriginTag({ origin, edited }: { origin: string; edited?: boolean }) {
  if (origin === "ai") return <span className="inline-flex items-center gap-1">{edited ? <span className="text-[11.5px] text-ink-2">AI-drafted, edited</span> : <AiMark label="AI-drafted" />}</span>;
  return <span className="text-[11.5px] text-faint">{Q_ORIGIN[origin] ?? origin}{edited ? " · edited" : ""}</span>;
}

/** One competency: description, rubric anchors and questions — all editable. */
export function CompetencyCard({ c, index, total }: { c: CompetencyView; index: number; total: number }) {
  const [editing, setEditing] = useState(false);
  const [adding, setAdding] = useState(false);
  const [state, action, pending] = useServerForm(updateCompetency.bind(null, c.id));
  useOkToast(state, () => setEditing(false));
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-line bg-[#fbfaf8] px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] tabular-nums text-faint">{index + 1}.</span>
            <h3 className="font-medium">{c.name}</h3>
            <Badge>{c.importance === "essential" ? "Essential" : "Preferred"}</Badge>
            {c.origin === "recruiter" ? <Badge tone="warn">Added by recruiter — not in the role&apos;s criteria</Badge> : <span className="text-[11.5px] text-faint">From the role&apos;s approved criteria</span>}
          </div>
          {c.description && <p className="mt-0.5 text-[12.5px] text-muted">{c.description}</p>}
        </div>
        <div className="flex items-center gap-1">
          <IconBtn label={`Move ${c.name} up`} disabled={index === 0} onClick={() => moveCompetency(c.id, -1)}>↑</IconBtn>
          <IconBtn label={`Move ${c.name} down`} disabled={index === total - 1} onClick={() => moveCompetency(c.id, 1)}>↓</IconBtn>
          <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? "Close" : "Edit"}
          </Button>
          <ActionButton action={() => removeCompetency(c.id)} variant="ghost" confirm={`Remove “${c.name}” and its questions from this kit?`} successMessage="Removed">
            Remove
          </ActionButton>
        </div>
      </div>

      {editing ? (
        <ActionForm action={action} pending={pending} className="space-y-3 px-4 py-3">
          <Field label="Competency">
            <Input name="name" defaultValue={c.name} maxLength={300} required />
          </Field>
          <Field label="Description">
            <Textarea name="description" defaultValue={c.description} rows={2} maxLength={2000} />
          </Field>
          <fieldset className="space-y-2">
            <legend className="text-[13px] font-medium">Rubric anchors — what an answer at each level shows</legend>
            {RATING_LEVELS.map((l) => (
              <Field key={l} label={`${l} · ${RATING_LABEL[l]}`}>
                <Textarea name={`a${l}`} defaultValue={c.anchors[String(l) as keyof Anchors]} rows={2} maxLength={600} required />
              </Field>
            ))}
          </fieldset>
          <div className="flex items-center gap-2">
            <FormMessage state={state?.ok ? undefined : state} />
            <SubmitButton size="sm" className="ml-auto" pendingLabel="Saving…">
              Save
            </SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <details className="border-b border-line px-4 py-2 text-[12.5px]">
          <summary className="cursor-pointer text-muted">
            Rubric anchors <span className="ml-1">{c.anchorsOrigin === "ai" ? <AiMark label="AI-drafted" /> : <span className="text-faint">{c.anchorsOrigin === "recruiter" ? "· edited" : "· template"}</span>}</span>
          </summary>
          <dl className="mt-2 grid gap-1.5 sm:grid-cols-2">
            {RATING_LEVELS.map((l) => (
              <div key={l} className="rounded-md bg-sunken/60 px-2.5 py-1.5">
                <dt className="font-medium">
                  {l} · {RATING_LABEL[l]}
                </dt>
                <dd className="text-ink-2">{c.anchors[String(l) as keyof Anchors]}</dd>
              </div>
            ))}
          </dl>
        </details>
      )}

      <ol className="divide-y divide-line">
        {c.questions.map((q, i) => (
          <QuestionRow key={q.id} q={q} index={i} total={c.questions.length} />
        ))}
        {c.questions.length === 0 && <li className="px-4 py-3 text-[12.5px] text-faint">No questions yet — add one so every interviewer asks the same thing.</li>}
      </ol>
      <div className="border-t border-line px-4 py-2.5">
        {adding ? <QuestionForm action={addQuestion.bind(null, c.id)} onDone={() => setAdding(false)} submitLabel="Add question" /> : (
          <Button size="sm" variant="ghost" onClick={() => setAdding(true)}>
            + Add question
          </Button>
        )}
      </div>
    </Card>
  );
}

function QuestionRow({ q, index, total }: { q: QuestionView; index: number; total: number }) {
  const [editing, setEditing] = useState(false);
  return (
    <li className="px-4 py-3">
      {editing ? (
        <QuestionForm action={updateQuestion.bind(null, q.id)} initial={q} onDone={() => setEditing(false)} submitLabel="Save" />
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0 flex-1">
            <p className="text-[13.5px]">{q.text}</p>
            {q.followUps && (
              <ul className="mt-1 list-disc pl-5 text-[12.5px] text-ink-2">
                {q.followUps.split("\n").filter(Boolean).map((f, i) => (
                  <li key={i}>{f}</li>
                ))}
              </ul>
            )}
            {q.guidance && <p className="mt-1 text-[12px] text-muted">Interviewer note: {q.guidance}</p>}
            <div className="mt-1">
              <OriginTag origin={q.origin} edited={q.edited} />
            </div>
          </div>
          <div className="flex items-center gap-1">
            <IconBtn label="Move question up" disabled={index === 0} onClick={() => moveQuestion(q.id, -1)}>↑</IconBtn>
            <IconBtn label="Move question down" disabled={index === total - 1} onClick={() => moveQuestion(q.id, 1)}>↓</IconBtn>
            <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
              Edit
            </Button>
            <ActionButton action={() => removeQuestion(q.id)} variant="ghost" confirm="Remove this question?" successMessage="Question removed">
              Remove
            </ActionButton>
          </div>
        </div>
      )}
    </li>
  );
}

function QuestionForm({ action: serverAction, initial, onDone, submitLabel }: { action: (prev: { ok?: boolean; error?: string; message?: string } | undefined, fd: FormData) => Promise<{ ok?: boolean; error?: string; message?: string } | undefined>; initial?: QuestionView; onDone: () => void; submitLabel: string }) {
  const [state, action, pending] = useServerForm(serverAction);
  useOkToast(state, onDone);
  return (
    <ActionForm action={action} pending={pending} className="space-y-2">
      <Field label="Question">
        <Textarea name="text" defaultValue={initial?.text} rows={2} maxLength={1000} required />
      </Field>
      <Field label="Follow-up prompts (optional, one per line)">
        <Textarea name="followUps" defaultValue={initial?.followUps} rows={2} maxLength={1000} />
      </Field>
      <Field label="Interviewer note (optional)" hint="What job-relevant evidence for this competency looks like.">
        <Input name="guidance" defaultValue={initial?.guidance} maxLength={1000} />
      </Field>
      <div className="flex items-center gap-2">
        <FormMessage state={state?.ok ? undefined : state} />
        <div className="ml-auto flex gap-2">
          <Button type="button" size="sm" variant="ghost" onClick={onDone}>
            Cancel
          </Button>
          <SubmitButton size="sm" pendingLabel="Saving…">
            {submitLabel}
          </SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

function IconBtn({ label, disabled, onClick, children }: { label: string; disabled?: boolean; onClick: () => Promise<unknown>; children: React.ReactNode }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled || busy}
      onClick={async () => {
        setBusy(true);
        await onClick();
        setBusy(false);
        router.refresh();
      }}
      className="h-7 w-7 rounded-md text-[13px] text-muted hover:bg-sunken hover:text-ink disabled:opacity-30"
    >
      {children}
    </button>
  );
}

export function AddCompetencyForm({ kitId, available }: { kitId: string; available: { id: string; name: string }[] }) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(available.length === 0);
  const [state, action, pending] = useServerForm(addCompetency.bind(null, kitId));
  useOkToast(state, () => setOpen(false));
  if (!open)
    return (
      <Button size="sm" onClick={() => setOpen(true)}>
        + Add competency
      </Button>
    );
  return (
    <Card className="p-4">
      <ActionForm action={action} pending={pending} className="space-y-3">
        {!custom ? (
          <Field label="From the role's approved criteria">
            <Select name="criterionId" required defaultValue="">
              <option value="" disabled>
                Choose a criterion…
              </option>
              {available.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <>
            <Field label="Competency name" hint="It will be labeled “Added by recruiter — not in the role's criteria”. Keep it job-related.">
              <Input name="name" required maxLength={300} />
            </Field>
            <Field label="Description">
              <Textarea name="description" rows={2} maxLength={2000} />
            </Field>
          </>
        )}
        <div className="flex flex-wrap items-center gap-2">
          {available.length > 0 && (
            <button type="button" onClick={() => setCustom(!custom)} className="text-[12.5px] text-muted underline">
              {custom ? "Choose from the role's criteria instead" : "Add a competency that isn't in the criteria"}
            </button>
          )}
          <FormMessage state={state?.ok ? undefined : state} />
          <div className="ml-auto flex gap-2">
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <SubmitButton size="sm" pendingLabel="Adding…">
              Add
            </SubmitButton>
          </div>
        </div>
      </ActionForm>
    </Card>
  );
}

/** A stage: purpose, competencies covered, manual schedule note, and interviewers. */
export function StageCard({ stage, competencies, members, canRemove, scheduleSlot }: { stage: StageView; competencies: { id: string; name: string }[]; members: Member[]; canRemove: boolean; scheduleSlot?: React.ReactNode }) {
  const [editing, setEditing] = useState(!stage.competencyIds.length);
  const [state, action, pending] = useServerForm(updateStage.bind(null, stage.id));
  const [pick, setPick] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  useOkToast(state, () => setEditing(false));
  const assigned = new Set(stage.assignments.map((a) => a.interviewerId));
  const covered = competencies.filter((c) => stage.competencyIds.includes(c.id));
  const local = stage.scheduledAt ? new Date(new Date(stage.scheduledAt).getTime() - new Date(stage.scheduledAt).getTimezoneOffset() * 60000).toISOString().slice(0, 16) : "";
  const [when, setWhen] = useState(local);
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h3 className="font-medium">{stage.name}</h3>
          {stage.purpose && <p className="text-[12.5px] text-muted">{stage.purpose}</p>}
        </div>
        <div className="flex gap-1">
          <Button size="sm" variant="ghost" onClick={() => setEditing(!editing)}>
            {editing ? "Close" : "Edit"}
          </Button>
          {canRemove && (
            <ActionButton action={() => removeStage(stage.id)} variant="ghost" confirm={`Remove the stage “${stage.name}”?`} successMessage="Stage removed">
              Remove
            </ActionButton>
          )}
        </div>
      </div>

      {editing ? (
        <ActionForm action={action} pending={pending} className="mt-3 space-y-3">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Stage name">
              <Input name="name" defaultValue={stage.name} required maxLength={120} />
            </Field>
            <Field label="Purpose">
              <Input name="purpose" defaultValue={stage.purpose} maxLength={500} placeholder="e.g. Technical depth on system design" />
            </Field>
          </div>
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium">Competencies assessed in this stage</legend>
            <div className="grid gap-1 sm:grid-cols-2">
              {competencies.map((c) => (
                <label key={c.id} className="flex items-start gap-2 text-[12.5px]">
                  <input type="checkbox" name="competencyId" value={c.id} defaultChecked={stage.competencyIds.includes(c.id)} className="mt-0.5" />
                  {c.name}
                </label>
              ))}
            </div>
          </fieldset>
          <fieldset className="rounded-lg border border-dashed border-line-strong p-3">
            <legend className="px-1 text-[12.5px] font-medium">Schedule (entered manually)</legend>
            <p className="mb-2 text-[12px] text-muted">For interviews you booked outside Talyn. These details are for the team&apos;s reference only — Talyn doesn&apos;t send invites from here. Use “Schedule interview” to book through Google Calendar.</p>
            <div className="grid gap-3 sm:grid-cols-3">
              <Field label="Date and time">
                <Input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
                {/* Sent as an exact instant so the server doesn't reinterpret it in its own time zone. */}
                <input type="hidden" name="scheduledAt" value={when ? new Date(when).toISOString() : ""} />
              </Field>
              <Field label="Duration (min)">
                <Input name="durationMins" type="number" min={5} max={480} defaultValue={stage.durationMins ?? ""} />
              </Field>
              <Field label="Location or link">
                <Input name="locationNote" defaultValue={stage.locationNote ?? ""} maxLength={300} placeholder="e.g. Video call — link in calendar" />
              </Field>
            </div>
          </fieldset>
          <div className="flex items-center gap-2">
            <FormMessage state={state?.ok ? undefined : state} />
            <SubmitButton size="sm" className="ml-auto" pendingLabel="Saving…">
              Save stage
            </SubmitButton>
          </div>
        </ActionForm>
      ) : (
        <div className="mt-2 space-y-1 text-[12.5px]">
          <div>
            <span className="text-muted">Assesses: </span>
            {covered.length ? covered.map((c) => c.name).join(" · ") : <span className="text-warn">No competencies chosen</span>}
          </div>
          <div className="text-muted">
            {stage.scheduledAt
              ? `${new Date(stage.scheduledAt).toLocaleString("en-US", { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}${stage.durationMins ? ` · ${stage.durationMins} min` : ""}${stage.locationNote ? ` · ${stage.locationNote}` : ""} — entered manually, not booked by Talyn`
              : "Not scheduled — book it in your own calendar and note it here"}
          </div>
        </div>
      )}

      {scheduleSlot && <div className="mt-3 border-t border-line pt-3">{scheduleSlot}</div>}

      <div className="mt-3 border-t border-line pt-3">
        <div className="mb-1.5 text-[12px] font-semibold uppercase tracking-wide text-muted">Interviewers</div>
        {stage.assignments.length === 0 ? (
          <p className="text-[12.5px] text-faint">No one assigned yet.</p>
        ) : (
          <ul className="space-y-1 text-[12.5px]">
            {stage.assignments.map((a) => (
              <li key={a.id} className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{a.interviewerName}</span>
                <span className={clsx(a.status === "submitted" ? "text-ok" : "text-muted")}>
                  {STATUS[a.status]}
                  {a.submittedAt ? ` ${new Date(a.submittedAt).toLocaleDateString()}` : ""}
                </span>
                {a.status !== "submitted" && (
                  <ActionButton action={() => unassignInterviewer(a.id)} variant="ghost" successMessage="Interviewer removed">
                    Remove
                  </ActionButton>
                )}
              </li>
            ))}
          </ul>
        )}
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Select value={pick} onChange={(e) => setPick(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label={`Add interviewer to ${stage.name}`}>
            <option value="">Add interviewer…</option>
            {members
              .filter((m) => !assigned.has(m.userId))
              .map((m) => (
                <option key={m.userId} value={m.userId}>
                  {m.name}
                </option>
              ))}
          </Select>
          <Button
            size="sm"
            disabled={!pick}
            onClick={async () => {
              const r = await assignInterviewer(stage.id, pick);
              setErr(r?.error ?? null);
              setPick("");
              router.refresh();
            }}
          >
            Assign
          </Button>
          {members.length <= 1 && <span className="text-[12px] text-muted">Only you are in this workspace — invite interviewers in Settings → Team.</span>}
        </div>
        {err && <p className="mt-1 text-[12px] text-danger">{err}</p>}
      </div>
    </Card>
  );
}

export function HiringManagerSelect({ kitId, value, members }: { kitId: string; value: string | null; members: Member[] }) {
  const router = useRouter();
  return (
    <Select
      aria-label="Hiring manager for this plan"
      defaultValue={value ?? ""}
      className="h-8 w-auto text-[12.5px]"
      onChange={async (e) => {
        await setHiringManager(kitId, e.target.value);
        router.refresh();
      }}
    >
      <option value="">Not set</option>
      {members.map((m) => (
        <option key={m.userId} value={m.userId}>
          {m.name}
        </option>
      ))}
    </Select>
  );
}
