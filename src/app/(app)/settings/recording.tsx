"use client";

import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Textarea } from "@/components/ui";
import { setRecordingPolicy } from "@/server/transcript-actions";

/** Admin form: the organisation's recording & consent process, and the on/off switch. */
export function RecordingPolicyForm({ enabled, policy, isAdmin }: { enabled: boolean; policy: string; isAdmin: boolean }) {
  const [state, action, pending] = useServerForm(setRecordingPolicy);
  if (!isAdmin)
    return policy ? (
      <blockquote className="whitespace-pre-wrap rounded-lg bg-sunken/60 p-3 text-[13px] text-ink-2">{policy}</blockquote>
    ) : (
      <p className="text-[13px] text-muted">An admin hasn&apos;t described the recording and consent process yet.</p>
    );
  return (
    <ActionForm action={action} pending={pending} className="space-y-2">
      <label className="block text-[12.5px] font-medium" htmlFor="recordingPolicy">
        Your recording &amp; consent process
      </label>
      <Textarea
        id="recordingPolicy"
        name="recordingPolicy"
        rows={4}
        maxLength={2000}
        defaultValue={policy}
        placeholder="e.g. The interviewer tells the candidate at the start that the call is transcribed for the hiring team's notes, asks for agreement, and stops if they decline. The invite also says so. Transcripts are kept with the candidate record and deleted with it."
      />
      <p className="text-[12px] text-muted">Interviewers see this text and must confirm they followed it each time they add a transcript or recording.</p>
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton size="sm" variant={enabled ? "secondary" : "primary"} name="enable" value="1" pendingLabel="Saving…">
          {enabled ? "Save process" : "Turn on with this process"}
        </SubmitButton>
        {enabled && (
          <SubmitButton size="sm" variant="ghost" name="enable" value="0" pendingLabel="Saving…">
            Turn off
          </SubmitButton>
        )}
        <FormMessage state={state} />
      </div>
    </ActionForm>
  );
}
