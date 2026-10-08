"use client";

import { ActionButton, ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Select } from "@/components/ui";
import { applyRetentionNow, setRetention } from "@/server/settings-actions";

const OPTIONS = [
  { value: "", label: "Keep until deleted" },
  { value: "180", label: "180 days of inactivity" },
  { value: "365", label: "1 year of inactivity" },
  { value: "730", label: "2 years of inactivity" },
  { value: "1095", label: "3 years of inactivity" },
];

export function RetentionForm({ days, eligible, cronConfigured }: { days: number | null; eligible: number | null; cronConfigured: boolean }) {
  const [state, action, pending] = useServerForm(setRetention);
  const current = days == null ? "" : String(days);
  return (
    <div className="space-y-3">
      <ActionForm action={action} pending={pending} className="flex flex-wrap items-center gap-2">
        <Select name="retentionDays" defaultValue={OPTIONS.some((o) => o.value === current) ? current : current} className="w-auto">
          {OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
          {!OPTIONS.some((o) => o.value === current) && <option value={current}>{current} days of inactivity</option>}
        </Select>
        <SubmitButton size="sm" variant="secondary" pendingLabel="Saving…">
          Save
        </SubmitButton>
        <FormMessage state={state} />
      </ActionForm>
      {days != null && (
        <div className="flex flex-wrap items-center gap-3 text-[13px] text-ink-2">
          <span>{eligible ?? 0} candidate{eligible === 1 ? " is" : "s are"} currently past this period.</span>
          {!!eligible && (
            <ActionButton
              action={applyRetentionNow}
              variant="danger"
              confirm={`Permanently delete ${eligible} inactive candidates, their CV files, notes, applications and assessments? This cannot be undone.`}
              successMessage="Retention applied"
            >
              Delete them now
            </ActionButton>
          )}
          <span className="text-[12px] text-muted">
            {cronConfigured ? "Also applied automatically every day." : "Automatic daily deletion runs only when CRON_SECRET is configured on the server."}
          </span>
        </div>
      )}
    </div>
  );
}
