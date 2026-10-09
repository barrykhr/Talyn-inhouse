"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionForm, ActionButton, FormMessage, Spinner, SubmitButton, useServerForm, usePendingTask } from "@/components/client";
import { useToast } from "@/components/toast";
import { AiMark, Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { IMPORTANCE_LABEL } from "@/lib/domain";
import { reassessRole } from "@/server/assessment-actions";
import {
  addCriterion,
  approveAllProposed,
  deleteCriterion,
  proposeCriteria,
  setCriterionStatus,
  updateCriterion,
  updateRubric,
} from "@/server/criteria-actions";
import type { ActionState } from "@/server/form";

export type CriterionView = {
  id: string;
  name: string;
  description: string;
  importance: string;
  kind: string;
  aliases: string;
  mappedCriterionId: string | null;
  priority: number | null;
  origin: string;
  originalName: string | null;
  originalDescription: string | null;
  edited: boolean;
  sourceText: string | null;
  sourcePage: number | null;
  sourceSection: string | null;
  rationale: string | null;
  status: string;
  approvedAt: string | null;
};

export function ProposePanel({ roleId, aiConfigured, hasDescription, hasCriteria }: { roleId: string; aiConfigured: boolean; hasDescription: boolean; hasCriteria: boolean }) {
  const router = useRouter();
  const [pending, start] = usePendingTask();
  const [which, setWhich] = useState<"ai" | "extract" | null>(null);
  const [state, setState] = useState<ActionState>(undefined);
  const run = (mode: "ai" | "extract") => {
    setWhich(mode);
    setState(undefined);
    start(async () => {
      const r = await proposeCriteria(roleId, mode);
      setState(r);
      if (r?.ok) router.refresh();
    });
  };
  return (
    <Card className="p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-medium">{hasCriteria ? "Suggest more skills and criteria from the job description" : "Suggest skills and criteria from the job description"}</div>
          <p className="text-[13px] text-muted">
            Suggestions only list what the JD states, with the excerpt. They aren&apos;t used until you approve them. Re-running replaces suggestions still awaiting review.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            onClick={() => run("extract")}
            disabled={pending || !hasDescription}
            title="Uses bullet points under requirement headings. No AI."
          >
            {pending && which === "extract" && <Spinner />}Extract bullet points
          </Button>
          <Button
            variant="signal"
            onClick={() => run("ai")}
            disabled={pending || !hasDescription || !aiConfigured}
            title={aiConfigured ? "Ask AI to propose criteria with citations from the job description" : "Add an AI API key in Settings to enable"}
          >
            {pending && which === "ai" ? <Spinner /> : null}
            {pending && which === "ai" ? "Reading description…" : "Propose with AI"}
          </Button>
        </div>
      </div>
      {!hasDescription && <p className="mt-2 text-[13px] text-warn">Add a job description to the role first.</p>}
      {!aiConfigured && hasDescription && (
        <p className="mt-2 text-[12.5px] text-muted">AI proposals are off. Set <code className="font-mono">OPENAI_API_KEY</code> or <code className="font-mono">ANTHROPIC_API_KEY</code> to enable them; bullet extraction and manual criteria work without it.</p>
      )}
      {state && <div className="mt-2"><FormMessage state={state} /></div>}
    </Card>
  );
}

export function ReviewBanner({ roleId, count }: { roleId: string; count: number }) {
  return (
    <Notice tone="signal" className="flex flex-wrap items-center justify-between gap-2">
      <span>
        <strong>{count} suggestion{count === 1 ? " needs" : "s need"} review.</strong> Edit wording, choose skill or criterion and required or preferred, then approve. Only approved items are used in assessments.
      </span>
      <ActionButton action={() => approveAllProposed(roleId)} variant="secondary" confirm={`Approve all ${count} suggestions as currently worded?`} successMessage={`${count} approved`}>
        Approve all as written
      </ActionButton>
    </Notice>
  );
}

export type CriterionOption = { id: string; name: string };

export function CriterionRow({ c, options = [], mappedName }: { c: CriterionView; options?: CriterionOption[]; mappedName?: string | null }) {
  const [editing, setEditing] = useState(false);
  const [showSource, setShowSource] = useState(false);
  const proposed = c.status === "proposed";
  const rejected = c.status === "rejected";
  return (
    <div className={clsx("px-4 py-3", proposed && "bg-[#fffaf6]", rejected && "opacity-60")}>
      {editing ? (
        <CriterionForm
          action={updateCriterion.bind(null, c.id)}
          initial={c}
          options={options.filter((o) => o.id !== c.id)}
          submitLabel="Save"
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <span className="font-medium">{c.name}</span>
              {(proposed || rejected) && (
                <span className="text-[12px] text-muted">
                  {c.kind === "skill" ? "Skill" : "Criterion"} · {IMPORTANCE_LABEL[c.importance] ?? c.importance}
                </span>
              )}
              {proposed && <span className="rounded-md border border-dashed border-signal/60 px-1.5 text-[11px] font-semibold text-signal">Suggestion · not in use</span>}
              {c.kind === "skill" && c.aliases && <span className="text-[12px] text-muted">also: {c.aliases}</span>}
              {mappedName && <span className="text-[12px] text-muted">→ supports “{mappedName}”</span>}
              {c.priority != null && <span className="text-[12px] text-muted" title="Priority (1 = highest)">Priority {c.priority}</span>}
            </div>
            <div className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12px] text-faint">
              {c.origin === "ai" ? <AiMark label="AI suggestion from JD" /> : <span>{c.origin === "extracted" ? "From JD bullet (not AI)" : "Added by recruiter"}</span>}
              {c.edited && <span className="text-warn" title={`Originally: ${c.originalName ?? ""}`}>· edited by recruiter</span>}
              {c.sourcePage || c.sourceSection ? <span>· JD{c.sourcePage ? ` p.${c.sourcePage}` : ""}{c.sourceSection ? ` · ${c.sourceSection}` : ""}</span> : null}
            </div>
            {c.description && <p className="mt-1 text-[13px] text-ink-2">{c.description}</p>}
            {(c.sourceText || c.rationale) && (
              <button type="button" onClick={() => setShowSource((v) => !v)} className="mt-1 text-[12.5px] text-muted underline-offset-2 hover:text-ink hover:underline">
                {showSource ? "Hide source" : c.kind === "skill" ? "Where in the JD?" : "Why this criterion?"}
              </button>
            )}
            {showSource && (
              <div className="mt-2 space-y-1.5 border-l-2 border-line-strong pl-3">
                {c.sourceText ? (
                  <>
                    {(c.sourcePage || c.sourceSection) && (
                      <p className="text-[11.5px] text-muted">
                        JD{c.sourcePage ? ` · p.${c.sourcePage}` : ""}
                        {c.sourceSection ? ` · ${c.sourceSection}` : ""}
                      </p>
                    )}
                    <p className="quote text-ink-2">“{c.sourceText}”</p>
                  </>
                ) : (
                  c.origin === "ai" && <p className="text-[12.5px] text-warn">No exact citation in the job description was found for this proposal.</p>
                )}
                {c.rationale && <p className="text-[12.5px] text-muted">{c.rationale}</p>}
                {c.edited && c.originalName && <p className="text-[12.5px] text-muted">Original wording: “{c.originalName}”</p>}
              </div>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-1">
            {proposed && (
              <>
                <ActionButton action={() => setCriterionStatus(c.id, "approved")} variant="primary" successMessage="Approved — now used in assessments">Approve</ActionButton>
                <ActionButton action={() => setCriterionStatus(c.id, "rejected")} variant="ghost" successMessage="Criterion rejected">Reject</ActionButton>
              </>
            )}
            {rejected && <ActionButton action={() => setCriterionStatus(c.id, "proposed")} variant="ghost">Restore</ActionButton>}
            {!rejected && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
            <ActionButton action={() => deleteCriterion(c.id)} variant="ghost" confirm={`Delete this ${c.kind === "skill" ? "skill" : "criterion"}? Past assessments keep their snapshot.`}>
              Delete
            </ActionButton>
          </div>
        </div>
      )}
    </div>
  );
}

export function CriterionForm({
  action,
  initial,
  options = [],
  kind: fixedKind,
  submitLabel,
  onDone,
  onCancel,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  initial?: Partial<CriterionView>;
  options?: CriterionOption[];
  kind?: "skill" | "criterion";
  submitLabel: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [state, formAction, formActionPending] = useServerForm(action);
  const [key, setKey] = useState(0);
  const [kind, setKind] = useState<string>(fixedKind ?? initial?.kind ?? "criterion");
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) {
      toast({ message: kind === "skill" ? "Skill saved" : "Criterion saved" });
      onDone?.();
      setKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const skill = kind === "skill";
  return (
    <ActionForm key={key} action={formAction} pending={formActionPending} className="grid gap-3 sm:grid-cols-[1fr_150px_150px]">
      {fixedKind ? (
        <input type="hidden" name="kind" value={fixedKind} />
      ) : (
        <Field label="Type" className="sm:col-span-3">
          <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)} className="max-w-72">
            <option value="skill">Skill — one named skill, tool or competency</option>
            <option value="criterion">Evaluation criterion — experience, location, domain…</option>
          </Select>
        </Field>
      )}
      <Field label={skill ? "Skill" : "Criterion"}>
        <Input name="name" defaultValue={initial?.name} required maxLength={200} placeholder={skill ? "e.g. PostgreSQL" : "e.g. 3+ years building production APIs"} />
      </Field>
      <Field label="Importance">
        <Select name="importance" defaultValue={initial?.importance === "informational" && skill ? "preferred" : (initial?.importance ?? "essential")}>
          <option value="essential">Required</option>
          <option value="preferred">Preferred</option>
          {!skill && <option value="informational">Informational (not weighted)</option>}
        </Select>
      </Field>
      <Field label="Priority" hint="Optional, 1–10">
        <Input name="priority" type="number" min={1} max={10} defaultValue={initial?.priority ?? ""} />
      </Field>
      {skill && (
        <>
          <Field label="Also counts as" hint="Other names for the same skill, comma-separated, e.g. Postgres, PostgreSQL" className="sm:col-span-2">
            <Input name="aliases" defaultValue={initial?.aliases ?? ""} maxLength={500} />
          </Field>
          <Field label="Supports criterion" hint="Optional mapping to an evaluation criterion">
            <Select name="mappedCriterionId" defaultValue={initial?.mappedCriterionId ?? ""}>
              <option value="">None</option>
              {options.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.name}
                </option>
              ))}
            </Select>
          </Field>
        </>
      )}
      <Field label={skill ? "What counts as evidence" : "What would satisfy it"} className="sm:col-span-3">
        <Textarea
          name="description"
          defaultValue={initial?.description}
          rows={2}
          maxLength={2000}
          placeholder={skill ? "Optional, e.g. used it in a production system, not only coursework." : "Describe what evidence would show this criterion is met."}
        />
      </Field>
      <div className="flex items-center gap-2 sm:col-span-3">
        <FormMessage state={state?.ok ? undefined : state} />
        <div className="ml-auto flex gap-2">
          {onCancel && <Button type="button" variant="ghost" size="sm" onClick={onCancel}>Cancel</Button>}
          <SubmitButton size="sm" pendingLabel="Saving…">{submitLabel}</SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

export function AddCriterion({ roleId, kind = "criterion", options = [] }: { roleId: string; kind?: "skill" | "criterion"; options?: CriterionOption[] }) {
  const [open, setOpen] = useState(false);
  const noun = kind === "skill" ? "skill" : "criterion";
  if (!open)
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Add {noun}
      </Button>
    );
  return (
    <Card className="p-4">
      <CriterionForm action={addCriterion.bind(null, roleId)} kind={kind} options={options} submitLabel={`Add ${noun}`} onCancel={() => setOpen(false)} onDone={() => setOpen(false)} />
    </Card>
  );
}

/** Minimum required skills, partial credit and evaluation weights. Applied live; never rejects or hides anyone. */
export function RubricForm({
  roleId,
  requiredSkills,
  threshold,
  partialCredit,
  weightRequired,
  weightPreferred,
  updatedBy,
}: {
  roleId: string;
  requiredSkills: number;
  threshold: number | null;
  partialCredit: boolean;
  weightRequired: number;
  weightPreferred: number;
  updatedBy: string | null;
}) {
  const [state, formAction, pending] = useServerForm(updateRubric.bind(null, roleId));
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) toast({ message: "Rubric saved" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <ActionForm action={formAction} pending={pending} className="space-y-4">
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-semibold">Minimum required skills</legend>
        <div className="flex flex-wrap items-center gap-2 text-[13.5px]">
          <span>At least</span>
          <span className="w-20">
            <Input
              name="skillThreshold"
              type="number"
              min={1}
              max={Math.max(requiredSkills, 1)}
              defaultValue={threshold ?? ""}
              aria-label="Minimum number of required skills with evidence found"
              disabled={requiredSkills === 0}
            />
          </span>
          <span>
            of {requiredSkills} required skill{requiredSkills === 1 ? "" : "s"} with evidence found
          </span>
        </div>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" name="skillPartialCredit" defaultChecked={partialCredit} className="mt-0.5" />
          <span>
            Count <strong>Partial evidence</strong> toward the minimum
            <span className="block text-[12px] text-muted">Off by default: only “Evidence found” counts.</span>
          </span>
        </label>
        <p className="text-[12px] text-muted">
          Each candidate shows “Meets configured skill threshold”, “Below configured skill threshold” or “Needs review”. This describes the evidence only: no one is
          rejected, hidden, downgraded or advanced because of it. Leave empty for no minimum.
        </p>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-[13px] font-semibold">Evaluation criteria weights</legend>
        <div className="flex flex-wrap items-center gap-3 text-[13.5px]">
          <label className="flex items-center gap-2">
            Required
            <span className="w-20">
              <Input name="weightRequired" type="number" min={1} max={10} defaultValue={weightRequired} />
            </span>
          </label>
          <label className="flex items-center gap-2">
            Preferred
            <span className="w-20">
              <Input name="weightPreferred" type="number" min={1} max={10} defaultValue={weightPreferred} />
            </span>
          </label>
          <span className="text-[12px] text-muted">Informational criteria and skills are never weighted.</span>
        </div>
      </fieldset>
      <div className="flex flex-wrap items-center gap-2">
        <FormMessage state={state} />
        {updatedBy && <span className="text-[12px] text-faint">Last changed by {updatedBy}</span>}
        <SubmitButton size="sm" className="ml-auto" pendingLabel="Saving…">
          Save rubric
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

/** Recruiter-controlled reassessment of everyone in the role. */
export function ReassessButton({ roleId, outdated, total, aiConfigured }: { roleId: string; outdated: number; total: number; aiConfigured: boolean }) {
  return (
    <div className="flex flex-wrap items-center gap-2">
      <ActionButton
        action={() => reassessRole(roleId, "outdated")}
        variant={outdated ? "primary" : "secondary"}
        pendingLabel={aiConfigured ? "Reassessing with AI…" : "Reassessing…"}
        disabled={!outdated}
        confirm={outdated ? `Reassess ${outdated} candidate${outdated === 1 ? "" : "s"} ${aiConfigured ? "with AI" : "with the keyword check (AI is off)"}? Their decisions and stages don't change.` : undefined}
      >
        Reassess candidates{outdated ? ` (${outdated})` : ""}
      </ActionButton>
      {total > 0 && (
        <ActionButton action={() => reassessRole(roleId, "all")} variant="ghost" pendingLabel="Reassessing…" confirm={`Reassess all ${total} active candidates, including those already current?`}>
          Reassess all
        </ActionButton>
      )}
    </div>
  );
}
