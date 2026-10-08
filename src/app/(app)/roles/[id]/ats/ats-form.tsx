"use client";

import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Field, Select } from "@/components/ui";
import { saveRoleAtsSettings } from "@/server/ats-actions";

export function RoleAtsForm({
  roleId,
  jobs,
  jobId,
  stages,
  talynStages,
  mapping,
}: {
  roleId: string;
  jobs: { externalId: string; title: string; status?: string | null }[];
  jobId: string | null;
  stages: string[];
  talynStages: { key: string; label: string }[];
  mapping: Record<string, string | null>;
}) {
  const [state, action, pending] = useServerForm(saveRoleAtsSettings.bind(null, roleId));
  return (
    <ActionForm action={action} pending={pending} className="space-y-4">
      <Field label="ATS job" hint="Candidates who applied to this job in the ATS are attached to this role on sync.">
        <Select name="jobId" defaultValue={jobId ?? ""}>
          <option value="">Not linked</option>
          {jobs.map((j) => (
            <option key={j.externalId} value={j.externalId}>
              {j.title}
              {j.status ? ` (${j.status})` : ""}
            </option>
          ))}
        </Select>
      </Field>
      {jobId && (
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium">Stage mapping</legend>
          <p className="mb-2 text-[12.5px] text-muted">
            Recruiter stage changes in Talyn are pushed to the mapped ATS stage. Mapped ATS stage changes move the Talyn stage on sync. Unmapped stages are never synced. AI never changes a stage.
          </p>
          {stages.length === 0 && <p className="mb-2 text-[12.5px] text-warn">The ATS didn&apos;t return stages for this job. Save the job link, then reload.</p>}
          <div className="grid gap-2 sm:grid-cols-2">
            {talynStages.map((s) => (
              <label key={s.key} className="flex items-center justify-between gap-3 text-[13px]">
                <span>{s.label}</span>
                <Select name={`stage_${s.key}`} defaultValue={mapping[s.key] ?? "__none"} className="max-w-[60%]">
                  <option value="__none">Don&apos;t sync</option>
                  {stages.map((a) => (
                    <option key={a} value={a}>
                      {a}
                    </option>
                  ))}
                </Select>
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Save ATS settings</SubmitButton>
    </ActionForm>
  );
}
