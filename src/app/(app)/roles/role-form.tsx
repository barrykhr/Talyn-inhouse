"use client";

import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Card, Field, Input, LinkButton, Select, Textarea } from "@/components/ui";
import { EMPLOYMENT_TYPES, EMPLOYMENT_TYPE_LABEL, ROLE_STATUSES, ROLE_STATUS_LABEL } from "@/lib/domain";
import type { ActionState } from "@/server/form";

type RoleValues = { title: string; department: string; location: string; employmentType: string; status: string; description: string };

export function RoleForm({
  action,
  initial,
  submitLabel,
  cancelHref,
}: {
  action: (prev: ActionState, fd: FormData) => Promise<ActionState>;
  initial?: RoleValues;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, formActionPending] = useServerForm(action);
  return (
    <ActionForm action={formAction} pending={formActionPending}>
      <Card className="space-y-5 p-6">
        <Field label="Title">
          <Input name="title" defaultValue={initial?.title} placeholder="e.g. Senior Backend Engineer" required maxLength={160} autoFocus />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Department">
            <Input name="department" defaultValue={initial?.department} placeholder="e.g. Engineering" maxLength={120} />
          </Field>
          <Field label="Location">
            <Input name="location" defaultValue={initial?.location} placeholder="e.g. Berlin · Hybrid" maxLength={160} />
          </Field>
          <Field label="Employment type">
            <Select name="employmentType" defaultValue={initial?.employmentType ?? "full_time"}>
              {EMPLOYMENT_TYPES.map((t) => (
                <option key={t} value={t}>{EMPLOYMENT_TYPE_LABEL[t]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Status">
            <Select name="status" defaultValue={initial?.status ?? "draft"}>
              {ROLE_STATUSES.map((s) => (
                <option key={s} value={s}>{ROLE_STATUS_LABEL[s]}</option>
              ))}
            </Select>
          </Field>
        </div>
        <Field
          label="Job description"
          hint="Paste the full description. Requirements written as bullet points under headings like “Requirements” and “Nice to have” convert into criteria most reliably."
        >
          <Textarea name="description" defaultValue={initial?.description} rows={16} maxLength={30000} />
        </Field>
        <div className="flex items-center justify-between gap-3">
          <FormMessage state={state} />
          <div className="ml-auto flex gap-2">
            <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
            <SubmitButton pendingLabel="Saving…">{submitLabel}</SubmitButton>
          </div>
        </div>
      </Card>
    </ActionForm>
  );
}
