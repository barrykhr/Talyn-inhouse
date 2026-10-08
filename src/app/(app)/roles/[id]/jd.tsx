"use client";

import { useEffect, useState } from "react";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { SourceRef } from "@/components/source-ref";
import { Button, Card, Input, Notice, Select, Textarea } from "@/components/ui";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL } from "@/lib/domain";
import { LIST_LABEL } from "@/lib/extraction-fields";
import { reviewRoleExtraction, uploadJdToRole } from "@/server/jd-actions";

export type FactView = {
  id: string;
  field: string;
  value: unknown;
  editedValue: unknown;
  sourceQuote: string | null;
  sourcePage: number | null;
  sourceSection: string | null;
  verified: boolean;
  extractor: string;
  status: string;
};

const SCALARS = [
  { field: "title", label: "Title" },
  { field: "department", label: "Department" },
  { field: "location", label: "Location" },
  { field: "employment_type", label: "Employment type" },
] as const;

export function RoleReviewForm({
  roleId,
  facts,
  current,
}: {
  roleId: string;
  facts: FactView[];
  current: { title: string; department: string; location: string; employmentType: string };
}) {
  const [state, action, actionPending] = useServerForm(reviewRoleExtraction.bind(null, roleId));
  const scalar = new Map(facts.map((f) => [f.field, f]));
  const currentValue: Record<string, string> = {
    title: current.title,
    department: current.department,
    location: current.location,
    employment_type: current.employmentType,
  };
  return (
    <Card className="overflow-hidden border-[#f3cdbb]">
      <div className="border-b border-line bg-[#fffaf6] px-5 py-3">
        <div className="font-semibold">Review details extracted from the job description</div>
        <p className="text-[13px] text-muted">
          Tick what&apos;s right, correct anything that isn&apos;t, untick what shouldn&apos;t be used. Nothing here is applied to the role until you save.
        </p>
      </div>
      <ActionForm action={action} pending={actionPending} className="divide-y divide-line">
        {SCALARS.map(({ field, label }) => {
          const f = scalar.get(field);
          const extracted = typeof f?.value === "string" ? f.value : "";
          return (
            <div key={field} className="grid gap-2 px-5 py-3 sm:grid-cols-[150px_1fr]">
              <label className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
                <input type="checkbox" name={`use_${field}`} defaultChecked={!!f} className="accent-[var(--color-ink)]" />
                {label}
              </label>
              <div className="space-y-1">
                {field === "employment_type" ? (
                  <Select name={`value_${field}`} defaultValue={extracted || currentValue[field]} className="max-w-56">
                    {EMPLOYMENT_TYPES.map((t) => (
                      <option key={t} value={t}>{EMPLOYMENT_TYPE_LABEL[t]}</option>
                    ))}
                  </Select>
                ) : (
                  <Input name={`value_${field}`} defaultValue={extracted || (field === "title" && current.title.startsWith("Untitled role") ? "" : currentValue[field])} placeholder={f ? "" : "Not found in the JD — type a value and tick to use it"} />
                )}
                {f ? <SourceRef doc="JD" quote={f.sourceQuote} page={f.sourcePage} section={f.sourceSection} verified={f.verified} extractor={f.extractor} /> : <span className="text-[11.5px] text-faint">Not found in the JD</span>}
              </div>
            </div>
          );
        })}
        {Object.keys(LIST_LABEL).map((group) => {
          const items = facts.filter((f) => f.field === group);
          if (!items.length) return null;
          return (
            <div key={group} className="px-5 py-3">
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">{LIST_LABEL[group]}</div>
              <div className="space-y-2">
                {items.map((f) => (
                  <div key={f.id} className="flex items-start gap-2">
                    <input type="checkbox" name={`keep_${f.id}`} defaultChecked className="mt-2.5 accent-[var(--color-ink)]" aria-label="Keep" />
                    <div className="min-w-0 flex-1 space-y-1">
                      <Textarea name={`text_${f.id}`} rows={1} defaultValue={String(f.value ?? "")} className="min-h-9 text-[13px]" />
                      <SourceRef doc="JD" quote={f.sourceQuote} page={f.sourcePage} section={f.sourceSection} verified={f.verified} extractor={f.extractor} />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          );
        })}
        <div className="flex flex-wrap items-center gap-3 bg-[#fbfaf8] px-5 py-3">
          <label className="flex items-center gap-2 text-[13px] text-ink-2">
            <input type="checkbox" name="useJdText" defaultChecked className="accent-[var(--color-ink)]" />
            Use the uploaded JD text as the role&apos;s job description
          </label>
          <FormMessage state={state} />
          <SubmitButton className="ml-auto" pendingLabel="Saving…">Save reviewed details</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}

export function UploadJd({ roleId, hasJd }: { roleId: string; hasJd: boolean }) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const [state, action, actionPending] = useServerForm(uploadJdToRole.bind(null, roleId));
  useEffect(() => {
    if (state?.ok) setKey((k) => k + 1);
  }, [state]);
  if (!open)
    return (
      <Button size="sm" variant="secondary" onClick={() => setOpen(true)}>
        {hasJd ? "Upload a new version" : "Upload JD (PDF/DOCX)"}
      </Button>
    );
  return (
    <ActionForm key={key} action={action} pending={actionPending} className="w-full space-y-2">
      <Input name="jd" type="file" required accept=".pdf,.docx" className="h-auto py-1.5 text-[13px]" />
      {state?.error && <Notice tone="danger">{state.error}</Notice>}
      {state?.ok && state.message && <Notice tone="ok">{state.message}</Notice>}
      <div className="flex justify-end gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Close</Button>
        <SubmitButton size="sm" pendingLabel="Reading the JD…">Upload and extract</SubmitButton>
      </div>
    </ActionForm>
  );
}
