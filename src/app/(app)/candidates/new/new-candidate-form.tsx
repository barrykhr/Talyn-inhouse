"use client";

import { useActionState } from "react";
import { CandidateFields } from "@/components/candidate-fields";
import { FormMessage, SubmitButton } from "@/components/client";
import { Card, Field, Input, LinkButton, Select, SectionTitle, Textarea } from "@/components/ui";
import { createCandidate } from "@/server/candidate-actions";

export function NewCandidateForm({ roles, roleId }: { roles: { id: string; title: string }[]; roleId: string }) {
  const [state, action] = useActionState(createCandidate, undefined);
  return (
    <form action={action} className="space-y-5">
      <Card className="p-6">
        <SectionTitle>Profile</SectionTitle>
        <CandidateFields />
      </Card>
      <Card className="p-6">
        <SectionTitle hint="PDF, DOCX or TXT up to 4 MB — or paste the text. Stored privately in your workspace.">Resume</SectionTitle>
        <div className="space-y-4">
          <Input name="resume" type="file" accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain" className="h-auto py-1.5" />
          <Field label="…or paste resume text">
            <Textarea name="resumeText" rows={5} maxLength={100000} />
          </Field>
        </div>
      </Card>
      <Card className="grid gap-4 p-6 sm:grid-cols-2">
        <Field label="Add to role">
          <Select name="roleId" defaultValue={roleId}>
            <option value="">Not now</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{r.title}</option>
            ))}
          </Select>
        </Field>
        <Field label="Recruiter note" hint="Private to your team. Never used as assessment evidence." className="sm:col-span-2">
          <Textarea name="note" rows={2} maxLength={10000} />
        </Field>
      </Card>
      <div className="flex items-center gap-3">
        <FormMessage state={state} />
        <div className="ml-auto flex gap-2">
          <LinkButton href={roleId ? `/roles/${roleId}` : "/candidates"} variant="ghost">Cancel</LinkButton>
          <SubmitButton pendingLabel="Saving…">Add candidate</SubmitButton>
        </div>
      </div>
    </form>
  );
}
