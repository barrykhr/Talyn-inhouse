"use client";

import { useEffect, useState } from "react";
import { ActionButton, ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Button, Input, Textarea } from "@/components/ui";
import { deleteDemographics, importDemographics, reviewScoringFlag, setAccommodationText, setDemographicMonitoring } from "@/server/scoring-actions";
import { useRouter } from "next/navigation";

export function FlagReview({ versionId }: { versionId: string }) {
  const [note, setNote] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was reviewed and decided" className="h-8 min-w-64 flex-1 text-[12.5px]" maxLength={1000} />
      <Button
        size="sm"
        onClick={async () => {
          const r = await reviewScoringFlag(versionId, note).catch(() => ({ error: "Couldn't save." }));
          setMsg(r?.error ?? null);
          if (!r?.error) router.refresh();
        }}
      >
        Record review
      </Button>
      {msg && <p className="w-full text-[12px] text-danger">{msg}</p>}
    </div>
  );
}

export function AccommodationForm({ value }: { value: string }) {
  const [state, action, pending] = useServerForm(setAccommodationText);
  return (
    <ActionForm action={action} pending={pending} className="space-y-2">
      <Textarea name="accommodationText" defaultValue={value} rows={2} maxLength={1000} placeholder="e.g. If you'd like another way to be assessed, email talent@company.com — you don't need to say why." />
      <div className="flex items-center gap-2">
        <FormMessage state={state} />
        <SubmitButton size="sm" className="ml-auto" pendingLabel="Saving…">
          Save
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function MonitoringToggle({ enabled }: { enabled: boolean }) {
  const [state, action, pending] = useServerForm(setDemographicMonitoring);
  useEffect(() => {}, [state]);
  return (
    <ActionForm action={action} pending={pending} className="space-y-2 text-[13px]">
      <input type="hidden" name="enable" value={enabled ? "0" : "1"} />
      {!enabled && (
        <label className="flex items-start gap-2">
          <input type="checkbox" name="attest" className="mt-1" />
          <span>
            I confirm our organisation may lawfully collect and use self-reported demographic data for aggregate monitoring of this process in our jurisdictions, that candidates were told
            how it is used and could decline, and that only admins will see the aggregate results.
          </span>
        </label>
      )}
      <div className="flex items-center gap-2">
        <FormMessage state={state} />
        <SubmitButton size="sm" variant={enabled ? "secondary" : "primary"} pendingLabel="Saving…">
          {enabled ? "Turn off monitoring" : "Turn on monitoring"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function DemographicImport({ count }: { count: number }) {
  const [state, action, pending] = useServerForm(importDemographics);
  return (
    <div className="space-y-2">
      <ActionForm action={action} pending={pending} className="space-y-2">
        <Textarea name="csv" rows={4} placeholder={"email,category,value\nalex@example.com,gender,woman"} className="font-mono text-[12px]" />
        <div className="flex items-center gap-2">
          <FormMessage state={state} />
          <SubmitButton size="sm" className="ml-auto" pendingLabel="Importing…">
            Import self-reported responses
          </SubmitButton>
        </div>
      </ActionForm>
      {count > 0 && (
        <ActionButton action={() => deleteDemographics()} variant="danger" confirm={`Delete all ${count} stored responses? This can't be undone.`}>
          Delete all {count} responses
        </ActionButton>
      )}
    </div>
  );
}
