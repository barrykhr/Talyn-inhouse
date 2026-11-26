"use client";

import clsx from "clsx";
import { useState } from "react";
import { ActionForm, FormMessage, Spinner, SubmitButton, useServerForm } from "@/components/client";
import { useToast } from "@/components/toast";
import { buttonClass, Field, Input, Select, Textarea } from "@/components/ui";
import { ANSWER_RATING_LABEL, CALL_KIND_LABEL, INTERVIEWER_ROLE_LABEL, type Speaker, type SpeakerRole } from "@/lib/calls/core";
import { CONSENT_LABEL, CONSENT_METHODS } from "@/lib/transcripts/parse";
import { addCall, checkAnswer, generateBehavioural, setCallSpeakers, updateCallDetails } from "@/server/call-actions";
import type { AnswerCheckResult } from "@/lib/calls/ai";
import { useRouter } from "next/navigation";

type AppOption = { id: string; name: string };
const KIND_HINT: Record<string, string> = {
  intake: "The hiring manager describes what they want. Talyn compares their expectations with the JD.",
  screen: "A recruiter talks with a candidate. Talyn checks the candidate against the JD and benchmarks behavioural answers.",
  interview: "An interviewer or hiring manager talks with a candidate. Talyn also checks whether their questions match the JD.",
};

/** Adds a call to the role: what kind, who was on it, consent, and the transcript. */
export function AddCallForm({ roleId, applications, policy }: { roleId: string; applications: AppOption[]; policy: string }) {
  const [state, action, pending] = useServerForm(addCall.bind(null, roleId));
  const [kind, setKind] = useState<"intake" | "screen" | "interview">("interview");
  return (
    <ActionForm action={action} pending={pending} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-3">
        <fieldset className="sm:col-span-3">
          <legend className="mb-1 block text-[13px] font-medium text-ink-2">Kind of call</legend>
          <div className="flex flex-wrap gap-1.5">
            {(["interview", "screen", "intake"] as const).map((k) => (
              <label key={k} className={clsx("cursor-pointer rounded-lg border px-3 py-1.5 text-[13px] transition-colors has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand", kind === k ? "border-ink bg-ink text-white" : "border-line-strong hover:bg-sunken")}>
                <input type="radio" name="kind" value={k} checked={kind === k} onChange={() => setKind(k)} className="sr-only" />
                {CALL_KIND_LABEL[k]}
              </label>
            ))}
          </div>
          <p className="mt-1 text-[12px] text-muted">{KIND_HINT[kind]}</p>
        </fieldset>
        {kind !== "intake" && (
          <Field label="Candidate">
            <Select name="applicationId" defaultValue="" required>
              <option value="" disabled>
                Choose…
              </option>
              {applications.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <Field label={kind === "intake" ? "Hiring manager" : "Who asked the questions"}>
          <Input name="interviewerName" required maxLength={120} placeholder="Full name" />
        </Field>
        <Field label="Their part">
          <Select name="interviewerRole" defaultValue={kind === "screen" ? "recruiter" : "hiring_manager"} key={kind}>
            {(["hiring_manager", "interviewer", "recruiter"] as const).map((r) => (
              <option key={r} value={r}>
                {INTERVIEWER_ROLE_LABEL[r]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title (optional)">
          <Input name="title" maxLength={200} />
        </Field>
        <Field label="Date (optional)">
          <Input name="occurredAt" type="date" />
        </Field>
      </div>
      <Field label="Transcript" hint="Paste or upload the file your meeting tool or notetaker exports (VTT, SRT, or text with timestamps and speaker names).">
        <Textarea name="text" rows={6} placeholder={"00:00:05 Priya: Thanks for joining…\n00:00:12 Arjun: Happy to be here…"} />
      </Field>
      <label className="block text-[13px]">
        <span className="mb-1 block font-medium text-ink-2">Or upload the transcript file</span>
        <input type="file" name="file" accept=".vtt,.srt,.txt,text/plain,text/vtt" className="block text-[13px]" />
      </label>
      <fieldset className="space-y-2 rounded-md bg-sunken/60 p-3">
        <legend className="px-1 text-[12.5px] font-semibold">Consent</legend>
        <p className="text-[12px] text-ink-2">Your organisation&apos;s process: {policy}</p>
        <div className="grid gap-2 sm:grid-cols-2">
          <Field label="How consent was given">
            <Select name="consentMethod" defaultValue="verbal_at_start">
              {CONSENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {CONSENT_LABEL[m]}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" name="consentConfirmed" className="mt-0.5" />
          <span>I confirm everyone on this call was told it was transcribed and agreed, following this process.</span>
        </label>
      </fieldset>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Saving…">Save call</SubmitButton>
    </ActionForm>
  );
}

/** Sets a call's role, kind, candidate and interviewer (used for notetaker calls and edits). */
export function CallDetailsForm({
  callId,
  roles,
  current,
  applicationsByRole,
}: {
  callId: string;
  roles: { id: string; title: string }[];
  current: { roleId: string | null; kind: string; interviewerName: string | null; interviewerRole: string; applicationId: string | null; title: string };
  applicationsByRole: Record<string, AppOption[]>;
}) {
  const [state, action, pending] = useServerForm(updateCallDetails.bind(null, callId));
  const [roleId, setRoleId] = useState(current.roleId ?? "");
  const [kind, setKind] = useState(current.kind);
  const apps = applicationsByRole[roleId] ?? [];
  return (
    <ActionForm action={action} pending={pending} className="grid gap-3 sm:grid-cols-2">
      <Field label="Role">
        <Select name="roleId" value={roleId} onChange={(e) => setRoleId(e.target.value)} required>
          <option value="" disabled>
            Choose…
          </option>
          {roles.map((r) => (
            <option key={r.id} value={r.id}>
              {r.title}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Kind of call" hint={KIND_HINT[kind]}>
        <Select name="kind" value={kind} onChange={(e) => setKind(e.target.value)}>
          {(["interview", "screen", "intake"] as const).map((k) => (
            <option key={k} value={k}>
              {CALL_KIND_LABEL[k]}
            </option>
          ))}
        </Select>
      </Field>
      {kind !== "intake" && (
        <Field label="Candidate" hint={roleId && !apps.length ? "No active candidates in this role yet." : undefined}>
          <Select name="applicationId" defaultValue={current.applicationId ?? ""} key={roleId} required>
            <option value="" disabled>
              Choose…
            </option>
            {apps.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </Select>
        </Field>
      )}
      <Field label={kind === "intake" ? "Hiring manager" : "Who asked the questions"}>
        <Input name="interviewerName" defaultValue={current.interviewerName ?? ""} required maxLength={120} />
      </Field>
      <Field label="Their part">
        <Select name="interviewerRole" defaultValue={current.interviewerRole}>
          {(["hiring_manager", "interviewer", "recruiter"] as const).map((r) => (
            <option key={r} value={r}>
              {INTERVIEWER_ROLE_LABEL[r]}
            </option>
          ))}
        </Select>
      </Field>
      <Field label="Title">
        <Input name="title" defaultValue={current.title} maxLength={200} />
      </Field>
      <div className="sm:col-span-2 space-y-2">
        <FormMessage state={state} />
        <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}

const ROLE_OPTS: { value: SpeakerRole; label: string }[] = [
  { value: "candidate", label: "Candidate" },
  { value: "interviewer", label: "Interviewer / hiring manager" },
  { value: "other", label: "Someone else" },
];

/** Who each speaker label is, so the candidate's words and the interviewer's questions aren't mixed up. */
export function SpeakersForm({ callId, speakers, stats }: { callId: string; speakers: Speaker[]; stats: Record<string, { passages: number; words: number }> }) {
  const [value, setValue] = useState(speakers);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const save = async () => {
    setBusy(true);
    setErr(null);
    const r: { error?: string; message?: string } | undefined = await setCallSpeakers(callId, value).catch(() => ({ error: "Couldn’t save. Try again." }));
    setBusy(false);
    if (r?.error) setErr(r.error);
    else {
      toast({ message: r?.message ?? "Saved" });
      router.refresh();
    }
  };
  return (
    <div className="space-y-2">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {value.map((s, i) => (
          <li key={s.label} className="flex flex-wrap items-center gap-3 px-3 py-2 text-[13px]">
            <span className="min-w-0 flex-1">
              <span className="font-medium">{s.label}</span>
              <span className="ml-2 text-[12px] text-muted">
                {stats[s.label]?.passages ?? 0} passages · {stats[s.label]?.words ?? 0} words
              </span>
            </span>
            <Select aria-label={`Who is ${s.label}`} value={s.role} onChange={(e) => setValue(value.map((x, j) => (j === i ? { ...x, role: e.target.value as SpeakerRole } : x)))} className="w-auto">
              {ROLE_OPTS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </Select>
          </li>
        ))}
      </ul>
      <div className="flex items-center gap-2">
        <button type="button" onClick={save} disabled={busy} className={buttonClass("secondary", "sm")}>
          {busy && <Spinner />} Save speakers
        </button>
        {err && <span className="text-[12px] text-danger">{err}</span>}
      </div>
    </div>
  );
}

/** Generates (or regenerates) the behavioural question bank for the company's size. */
export function GenerateBankForm({ roleId, headcount, again }: { roleId: string; headcount: string; again: boolean }) {
  const [state, action, pending] = useServerForm(generateBehavioural.bind(null, roleId));
  return (
    <ActionForm action={action} pending={pending} className="flex flex-wrap items-end gap-2">
      <Field label="Company size (headcount)" hint={headcount === "not known" ? "Not known from the client profile; choose one." : "From the client profile; change it if it's wrong."}>
        <Select name="headcount" defaultValue={headcount} className="w-auto">
          {["1-50", "51-200", "201-1,000", "1,001-5,000", "5,001+", "not known"].map((b) => (
            <option key={b} value={b}>
              {b === "not known" ? "Not known" : `${b} people`}
            </option>
          ))}
        </Select>
      </Field>
      <SubmitButton pendingLabel="Writing questions… (up to a minute)" variant={again ? "secondary" : "primary"}>
        {again ? "Write them again" : "Write behavioural questions"}
      </SubmitButton>
      <div className="w-full">
        <FormMessage state={state} />
      </div>
    </ActionForm>
  );
}

const RATING_TONE: Record<string, string> = { strong: "bg-ok-soft text-ok", mixed: "bg-warn-soft text-warn", weak: "bg-danger-soft text-danger", not_answered: "bg-sunken text-muted" };

/** Paste notes of what the candidate said; Talyn compares them with the benchmark. Nothing is stored. */
export function AnswerCheck({ roleId, questionId }: { roleId: string; questionId: string }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<AnswerCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  if (!open)
    return (
      <button type="button" onClick={() => setOpen(true)} className="text-[12.5px] font-medium text-brand hover:underline">
        Check an answer against the benchmark →
      </button>
    );
  const run = async () => {
    setBusy(true);
    setErr(null);
    const r = await checkAnswer(roleId, questionId, text).catch(() => ({ error: "Couldn't run the check. Try again." }));
    setBusy(false);
    if ("error" in r) setErr(r.error);
    else setRes(r.result);
  };
  return (
    <div className="motion-fade mt-2 space-y-2 rounded-lg border border-line bg-surface p-3">
      <label className="block text-[12.5px] font-medium" htmlFor={`ans-${questionId}`}>
        What the candidate said (your notes)
      </label>
      <Textarea id={`ans-${questionId}`} rows={4} value={text} onChange={(e) => setText(e.target.value)} placeholder="e.g. Left a 4,000-person company because decisions took months; at their last job they owned the payments roadmap end to end…" />
      <div className="flex items-center gap-2">
        <button type="button" onClick={run} disabled={busy} className={buttonClass("primary", "sm")}>
          {busy && <Spinner />} Compare with benchmark
        </button>
        <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>
          Close
        </button>
        {err && <span className="text-[12px] text-danger">{err}</span>}
      </div>
      {res && (
        <div className="motion-fade space-y-1.5 border-t border-line pt-2 text-[13px]">
          <span className={clsx("inline-block rounded px-1.5 py-px text-[12px] font-semibold", RATING_TONE[res.rating])}>{ANSWER_RATING_LABEL[res.rating]}</span>
          {res.matched_signals.length > 0 && <p><span className="font-medium text-ok">Matched:</span> {res.matched_signals.join("; ")}</p>}
          {res.missing_signals.length > 0 && <p><span className="font-medium text-warn">Missing:</span> {res.missing_signals.join("; ")}</p>}
          {res.red_flags_seen.length > 0 && <p><span className="font-medium text-danger">Check:</span> {res.red_flags_seen.join("; ")}</p>}
          <p><span className="font-medium">Suggestion:</span> {res.suggestion}</p>
          <p><span className="font-medium">Ask next:</span> “{res.next_probe}”</p>
          <p className="text-[11.5px] text-faint">A suggestion from your notes only. You decide what it means.</p>
        </div>
      )}
    </div>
  );
}
