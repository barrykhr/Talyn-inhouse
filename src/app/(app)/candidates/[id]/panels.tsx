"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { CandidateFields } from "@/components/candidate-fields";
import { ActionButton, FormMessage, SubmitButton } from "@/components/client";
import { Button, Field, Input, Select, Textarea, formatDateTime } from "@/components/ui";
import { addNote, deleteCandidate, deleteNote, deleteResume, updateCandidate, uploadResume } from "@/server/candidate-actions";

export function ResumeUpload({ candidateId, hasResume }: { candidateId: string; hasResume: boolean }) {
  const [open, setOpen] = useState(!hasResume);
  const [state, action] = useActionState(uploadResume.bind(null, candidateId), undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      formRef.current?.reset();
      if (hasResume) setOpen(false);
    }
  }, [state, hasResume]);
  if (!open)
    return (
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)}>
        Replace resume
      </Button>
    );
  return (
    <form ref={formRef} action={action} className="space-y-3">
      <Input name="resume" type="file" accept=".pdf,.docx,.txt,.md" className="h-auto py-1.5 text-[13px]" />
      <Field label="…or paste text">
        <Textarea name="resumeText" rows={3} maxLength={100000} />
      </Field>
      <div className="flex items-center gap-2">
        <FormMessage state={state} />
        <div className="ml-auto flex gap-2">
          {hasResume && <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>}
          <SubmitButton size="sm" pendingLabel="Reading…">Save resume</SubmitButton>
        </div>
      </div>
    </form>
  );
}

export function DeleteResumeButton({ id }: { id: string }) {
  return (
    <ActionButton action={() => deleteResume(id)} variant="ghost" confirm="Delete this resume file and its text? Assessments that used it remain, without the link.">
      Delete
    </ActionButton>
  );
}

export function NoteForm({ candidateId, roles }: { candidateId: string; roles: { id: string; title: string }[] }) {
  const [state, action] = useActionState(addNote.bind(null, candidateId), undefined);
  const formRef = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) formRef.current?.reset();
  }, [state]);
  return (
    <form ref={formRef} action={action} className="space-y-2">
      <Textarea name="body" rows={2} placeholder="Add a note for your team…" maxLength={10000} />
      <div className="flex items-center gap-2">
        {roles.length > 0 && (
          <Select name="roleId" className="h-7 w-auto text-[12.5px]" defaultValue="">
            <option value="">General</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </Select>
        )}
        <FormMessage state={state?.ok ? undefined : state} />
        <SubmitButton size="sm" variant="secondary" className="ml-auto" pendingLabel="Saving…">Add note</SubmitButton>
      </div>
    </form>
  );
}

export function NoteItem({ note }: { note: { id: string; body: string; authorName: string; createdAt: string; roleTitle: string | null } }) {
  return (
    <li className="group py-2.5">
      <p className="whitespace-pre-wrap text-[13px] text-ink-2">{note.body}</p>
      <div className="mt-1 flex items-center gap-2 text-[11.5px] text-faint">
        <span>{note.authorName || "Unknown"} · {formatDateTime(note.createdAt)}{note.roleTitle ? ` · ${note.roleTitle}` : ""}</span>
        <span className="ml-auto opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100">
          <ActionButton action={() => deleteNote(note.id)} variant="ghost" confirm="Delete this note?">Delete</ActionButton>
        </span>
      </div>
    </li>
  );
}

type ProfileValues = Parameters<typeof CandidateFields>[0]["v"];

export function EditProfile({ candidateId, values }: { candidateId: string; values: ProfileValues }) {
  const [open, setOpen] = useState(false);
  const [state, action] = useActionState(updateCandidate.bind(null, candidateId), undefined);
  useEffect(() => {
    if (state?.ok) setOpen(false);
  }, [state]);
  if (!open)
    return (
      <Button size="md" onClick={() => setOpen(true)}>
        Edit profile
      </Button>
    );
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/30 px-4 py-10" role="dialog" aria-modal="true" aria-label="Edit profile">
      <form action={action} className="w-full max-w-2xl rounded-[var(--radius-card)] bg-surface p-6 shadow-xl">
        <h2 className="mb-4 text-lg font-semibold">Edit profile</h2>
        <CandidateFields v={values} />
        <div className="mt-5 flex items-center gap-2">
          <FormMessage state={state?.ok ? undefined : state} />
          <div className="ml-auto flex gap-2">
            <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            <SubmitButton pendingLabel="Saving…">Save</SubmitButton>
          </div>
        </div>
      </form>
    </div>
  );
}

export function DeleteCandidateButton({ id, name }: { id: string; name: string }) {
  return (
    <ActionButton
      size="md"
      variant="danger"
      action={() => deleteCandidate(id)}
      confirm={`Permanently delete ${name}? This removes their profile, resumes (including files), notes, pipeline history and assessments. This cannot be undone.`}
    >
      Delete
    </ActionButton>
  );
}
