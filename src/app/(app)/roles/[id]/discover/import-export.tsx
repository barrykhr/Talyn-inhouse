"use client";

import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Field, Input } from "@/components/ui";
import { importSourcingFile } from "@/server/sourcing-actions";

/** Import profiles exported from a source the organization is licensed to use. */
export function ImportExportForm({ strategyId, version }: { strategyId: string; version: number }) {
  const [state, action, pending] = useServerForm(importSourcingFile.bind(null, strategyId));
  return (
    <ActionForm action={action} pending={pending} className="space-y-3">
      <p className="text-[12.5px] text-muted">
        CSV from a tool or list your organization is licensed to use for recruiting (for example an export from a recruiting product, an event list with consent, or referrals). Columns:{" "}
        <code className="font-mono">name</code> (required), <code className="font-mono">title</code>, <code className="font-mono">company</code>, <code className="font-mono">location</code>,{" "}
        <code className="font-mono">email</code>, <code className="font-mono">linkedin_url</code>, <code className="font-mono">profile_url</code>, <code className="font-mono">skills</code>,{" "}
        <code className="font-mono">summary</code>, <code className="font-mono">updated_at</code>. Rows are matched against search v{version}; contact details are kept only if the file has them.
      </p>
      <Field label="Source">
        <Input name="sourceName" required maxLength={120} placeholder="e.g. Recruiting tool export, Spring career fair sign-ups" />
      </Field>
      <Field label="File (.csv, up to 1,000 rows)">
        <Input name="file" type="file" accept=".csv,text/csv" required />
      </Field>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" name="attest" className="mt-0.5" required />
        <span>I confirm my organization is licensed or has consent to use this data for recruiting, and the source&apos;s terms allow this use.</span>
      </label>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingLabel="Importing…">
        Import and match
      </SubmitButton>
    </ActionForm>
  );
}
