"use client";

import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { CONSENT_LABEL, CONSENT_METHODS } from "@/lib/transcripts/parse";
import { addTranscript } from "@/server/transcript-actions";

/** Adds a transcript or recording for one stage. Consent confirmation comes first and is required. */
export function AddTranscriptForm({ stageId, policy, audioReady }: { stageId: string; policy: string; audioReady: boolean }) {
  const [state, action, pending] = useServerForm(addTranscript.bind(null, stageId));
  const [source, setSource] = useState<"import" | "audio">("import");
  return (
    <ActionForm action={action} pending={pending} className="space-y-3 rounded-lg border border-line p-3">
      <fieldset className="space-y-2 rounded-md bg-sunken/60 p-3">
        <legend className="px-1 text-[12.5px] font-semibold">1. Consent</legend>
        <p className="text-[12px] text-ink-2">Your organisation&apos;s process: {policy}</p>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" name="consentConfirmed" className="mt-0.5" />
          <span>I confirm the candidate was told this interview would be recorded and transcribed, and agreed, following this process.</span>
        </label>
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
          <Field label="How consent was given">
            <Select name="consentMethod" defaultValue="">
              <option value="" disabled>
                Choose…
              </option>
              {CONSENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CONSENT_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Note (optional)">
            <Input name="consentNote" maxLength={500} placeholder="e.g. consent at 00:00 of the recording" />
          </Field>
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-[12.5px] font-semibold">2. Transcript</legend>
        <input type="hidden" name="source" value={source} />
        <div className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5 text-[12.5px]" role="group" aria-label="Source">
          <button type="button" onClick={() => setSource("import")} aria-pressed={source === "import"} className={source === "import" ? "rounded-md bg-ink px-2.5 py-1 font-medium text-white" : "px-2.5 py-1 text-muted"}>
            Import from meeting tool
          </button>
          <button
            type="button"
            onClick={() => audioReady && setSource("audio")}
            aria-pressed={source === "audio"}
            disabled={!audioReady}
            title={audioReady ? undefined : "No transcription provider is configured"}
            className={source === "audio" ? "rounded-md bg-ink px-2.5 py-1 font-medium text-white" : "px-2.5 py-1 text-muted disabled:opacity-50"}
          >
            Upload recording
          </button>
        </div>
        {source === "import" ? (
          <>
            <p className="text-[12px] text-muted">Google Meet, Zoom or Teams transcript as .vtt, .srt or text with a timestamp on each line. Without timestamps it can&apos;t be checked, so it isn&apos;t accepted.</p>
            <Input name="file" type="file" accept=".vtt,.srt,.txt,text/vtt,text/plain" className="h-auto py-1.5" />
            <Textarea name="text" rows={4} placeholder={"…or paste it here, e.g.\n00:01:05 Priya: Tell me about a pipeline report you built.\n00:01:12 Alex: At Acme I built…"} className="font-mono text-[12px]" />
          </>
        ) : (
          <>
            <p className="text-[12px] text-muted">Audio or video up to 24 MB. It&apos;s sent to the transcription provider and not stored by Talyn — only the timestamped text is kept.</p>
            <Input name="file" type="file" accept="audio/*,video/*,.m4a,.mp3,.wav,.webm,.mp4" className="h-auto py-1.5" />
          </>
        )}
      </fieldset>
      <div className="flex items-center gap-2">
        <FormMessage state={state} />
        <SubmitButton size="sm" className="ml-auto" pendingLabel={source === "audio" ? "Transcribing…" : "Importing…"}>
          {source === "audio" ? "Transcribe" : "Import transcript"}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}
