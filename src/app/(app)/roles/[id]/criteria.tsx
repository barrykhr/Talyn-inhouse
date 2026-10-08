"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionForm, ActionButton, FormMessage, Spinner, SubmitButton, useServerForm, usePendingTask } from "@/components/client";
import { AiMark, Badge, Button, Card, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { CRITERION_ORIGIN_LABEL } from "@/lib/domain";
import {
  addCriterion,
  approveAllProposed,
  deleteCriterion,
  proposeCriteria,
  setCriterionStatus,
  updateCriterion,
} from "@/server/criteria-actions";
import type { ActionState } from "@/server/form";

export type CriterionView = {
  id: string;
  name: string;
  description: string;
  importance: string;
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
          <div className="font-medium">{hasCriteria ? "Draft more criteria from the job description" : "Turn the job description into criteria"}</div>
          <p className="text-[13px] text-muted">
            Drafts are inactive until you approve them. Re-running replaces drafts still awaiting review.
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
        <strong>{count} proposed {count === 1 ? "criterion needs" : "criteria need"} review.</strong> Edit wording, set essential or preferred, then approve. Only approved criteria are used in assessments.
      </span>
      <ActionButton action={() => approveAllProposed(roleId)} variant="secondary" confirm={`Approve all ${count} proposed criteria as currently worded?`}>
        Approve all as written
      </ActionButton>
    </Notice>
  );
}

export function CriterionRow({ c }: { c: CriterionView }) {
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
          submitLabel="Save"
          onDone={() => setEditing(false)}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <div className="flex flex-wrap items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{c.name}</span>
              <Badge tone={c.importance === "essential" ? "ink" : "neutral"}>{c.importance === "essential" ? "Essential" : "Preferred"}</Badge>
              {c.priority != null && <Badge title="Priority (1 = highest)">P{c.priority}</Badge>}
              {c.origin === "ai" && <AiMark label="AI proposed" />}
              {c.origin === "extracted" && <Badge title={CRITERION_ORIGIN_LABEL.extracted}>From JD</Badge>}
              {c.edited && <Badge tone="warn" title={`Originally: ${c.originalName ?? ""}`}>Edited by recruiter</Badge>}
              {proposed && <Badge tone="signal">Awaiting approval</Badge>}
              {rejected && <Badge tone="gap">Rejected</Badge>}
            </div>
            {c.description && <p className="mt-1 text-[13px] text-ink-2">{c.description}</p>}
            {(c.sourceText || c.rationale) && (
              <button type="button" onClick={() => setShowSource((v) => !v)} className="mt-1 text-[12.5px] text-muted underline-offset-2 hover:text-ink hover:underline">
                {showSource ? "Hide source" : "Why this criterion?"}
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
                <ActionButton action={() => setCriterionStatus(c.id, "approved")} variant="primary">Approve</ActionButton>
                <ActionButton action={() => setCriterionStatus(c.id, "rejected")} variant="ghost">Reject</ActionButton>
              </>
            )}
            {rejected && <ActionButton action={() => setCriterionStatus(c.id, "proposed")} variant="ghost">Restore</ActionButton>}
            {!rejected && <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>Edit</Button>}
            <ActionButton action={() => deleteCriterion(c.id)} variant="ghost" confirm="Delete this criterion? Past assessments keep their snapshot.">
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
  submitLabel,
  onDone,
  onCancel,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  initial?: Partial<CriterionView>;
  submitLabel: string;
  onDone?: () => void;
  onCancel?: () => void;
}) {
  const [state, formAction, formActionPending] = useServerForm(action);
  const [key, setKey] = useState(0);
  useEffect(() => {
    if (state?.ok) {
      onDone?.();
      setKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <ActionForm key={key} action={formAction} pending={formActionPending} className="grid gap-3 sm:grid-cols-[1fr_150px_110px]">
      <Field label="Criterion">
        <Input name="name" defaultValue={initial?.name} required maxLength={200} placeholder="e.g. 3+ years building production APIs" />
      </Field>
      <Field label="Importance">
        <Select name="importance" defaultValue={initial?.importance ?? "essential"}>
          <option value="essential">Essential</option>
          <option value="preferred">Preferred</option>
        </Select>
      </Field>
      <Field label="Priority" hint="Optional, 1–10">
        <Input name="priority" type="number" min={1} max={10} defaultValue={initial?.priority ?? ""} />
      </Field>
      <Field label="What would satisfy it" className="sm:col-span-3">
        <Textarea name="description" defaultValue={initial?.description} rows={2} maxLength={2000} placeholder="Describe what evidence would show this criterion is met." />
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

export function AddCriterion({ roleId }: { roleId: string }) {
  const [open, setOpen] = useState(false);
  if (!open)
    return (
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)}>
        + Add criterion
      </Button>
    );
  return (
    <Card className="p-4">
      <CriterionForm action={addCriterion.bind(null, roleId)} submitLabel="Add criterion" onCancel={() => setOpen(false)} />
    </Card>
  );
}
