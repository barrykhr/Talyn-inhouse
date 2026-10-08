"use client";

import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { SourceRef } from "@/components/source-ref";
import { Card, Input } from "@/components/ui";
import { CORRECTION_REASONS } from "@/lib/domain";
import { CV_LISTS, CV_SCALARS } from "@/lib/extraction-fields";
import { reviewCvExtraction } from "@/server/cv-actions";

export type CvFact = {
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
  createdAt?: string;
  correctionReason?: string | null;
};

function ReasonSelect({ name }: { name: string }) {
  return (
    <select
      name={name}
      defaultValue=""
      aria-label="Reason for correction"
      className="h-7 rounded-md border border-line bg-surface px-1.5 text-[12px] text-muted focus:border-ink focus:outline-none"
    >
      <option value="">If you corrected it: why?</option>
      {CORRECTION_REASONS.map((r) => (
        <option key={r.value} value={r.value}>
          {r.label}
        </option>
      ))}
    </select>
  );
}

export function CvReviewForm({ candidateId, facts, current }: { candidateId: string; facts: CvFact[]; current: Record<string, string | null> }) {
  const [state, action, actionPending] = useServerForm(reviewCvExtraction.bind(null, candidateId));
  const scalar = new Map(facts.map((f) => [f.field, f]));
  return (
    <Card className="overflow-hidden border-[#f3cdbb]">
      <div className="border-b border-line bg-[#fffaf6] px-5 py-3">
        <div className="font-semibold">Review details extracted from the CV</div>
        <p className="text-[13px] text-muted">
          Everything below is AI- or parser-extracted and unreviewed. Nothing is used until you save. Correct anything that&apos;s wrong (and say why), untick
          anything that shouldn&apos;t be used. Fields the CV didn&apos;t contain are left blank — Talyn doesn&apos;t fill them in.
        </p>
      </div>
      <ActionForm action={action} pending={actionPending} className="divide-y divide-line">
        <div className="grid gap-x-6 gap-y-3 px-5 py-4 md:grid-cols-2">
          {CV_SCALARS.map(({ field, label, column }) => {
            const f = scalar.get(field);
            const extracted = typeof f?.value === "string" ? f.value : "";
            const existing = current[column] && !String(current[column]).startsWith("Unnamed candidate") ? String(current[column]) : "";
            return (
              <div key={field} className="space-y-1">
                <label className="flex items-center gap-2 text-[13px] font-medium text-ink-2">
                  <input type="checkbox" name={`use_${field}`} defaultChecked={!!f} className="accent-[var(--color-ink)]" />
                  {label}
                </label>
                <Input name={`value_${field}`} defaultValue={extracted || existing} placeholder={f ? "" : "Not found in CV"} />
                {f ? (
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <SourceRef doc="CV" quote={f.sourceQuote} page={f.sourcePage} section={f.sourceSection} verified={f.verified} extractor={f.extractor} at={f.createdAt} />
                    <ReasonSelect name={`reason_${field}`} />
                  </div>
                ) : (
                  <span className="text-[11.5px] text-faint">Not found in CV{existing ? " · showing current value" : ""} — tick to save a value you enter (recorded as recruiter-entered)</span>
                )}
              </div>
            );
          })}
        </div>

        {CV_LISTS.map((group) => {
          const items = facts.filter((f) => f.field === group.field);
          return (
            <div key={group.field} className="px-5 py-4">
              <div className="mb-2 text-[12px] font-semibold uppercase tracking-wide text-muted">
                {group.label} <span className="font-normal normal-case text-faint">· {items.length ? `${items.length} found` : "none found in CV"}</span>
              </div>
              <div className={group.keys.length ? "space-y-3" : "flex flex-wrap gap-2"}>
                {items.map((f) => {
                  const v = (f.value ?? {}) as Record<string, string>;
                  return group.keys.length ? (
                    <div key={f.id} className="flex items-start gap-2">
                      <input type="checkbox" name={`keep_${f.id}`} defaultChecked className="mt-2.5 accent-[var(--color-ink)]" aria-label="Keep" />
                      <div className="min-w-0 flex-1 space-y-1">
                        <div className="grid gap-2 sm:grid-cols-4">
                          {group.keys.map((k) => (
                            <Input key={k.key} name={`f_${f.id}_${k.key}`} defaultValue={v[k.key] ?? ""} placeholder={k.label} aria-label={k.label} className="h-8 text-[13px]" />
                          ))}
                        </div>
                        <div className="flex flex-wrap items-start justify-between gap-2">
                          <SourceRef doc="CV" quote={f.sourceQuote} page={f.sourcePage} section={f.sourceSection} verified={f.verified} extractor={f.extractor} at={f.createdAt} />
                          <ReasonSelect name={`reason_${f.id}`} />
                        </div>
                      </div>
                    </div>
                  ) : (
                    <label key={f.id} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong bg-surface py-1 pl-2 pr-1" title={f.sourceQuote ?? ""}>
                      <input type="checkbox" name={`keep_${f.id}`} defaultChecked className="accent-[var(--color-ink)]" />
                      <input name={`f_${f.id}_value`} defaultValue={String(f.value ?? "")} className="w-32 bg-transparent text-[13px] outline-none" aria-label="Skill" />
                      {!f.verified && <span className="text-[11px] text-warn" title="Not found verbatim in the CV">⚠</span>}
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}

        <div className="flex flex-wrap items-center gap-3 bg-[#fbfaf8] px-5 py-3">
          <FormMessage state={state} />
          <SubmitButton className="ml-auto" pendingLabel="Saving…">Save reviewed profile</SubmitButton>
        </div>
      </ActionForm>
    </Card>
  );
}
