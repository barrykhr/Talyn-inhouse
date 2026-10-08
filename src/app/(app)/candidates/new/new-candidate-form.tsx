"use client";

import clsx from "clsx";
import { useState } from "react";
import { CandidateFields } from "@/components/candidate-fields";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Card, Field, Input, LinkButton, Notice, Select, SectionTitle, Textarea } from "@/components/ui";
import { createCandidate } from "@/server/candidate-actions";
import { createCandidateFromCv } from "@/server/cv-actions";

export function NewCandidateForm({ roles, roleId, aiConfigured }: { roles: { id: string; title: string }[]; roleId: string; aiConfigured: boolean }) {
  const [tab, setTab] = useState<"upload" | "manual">("upload");
  const [role, setRole] = useState(roleId);
  const [cvState, cvAction, cvActionPending] = useServerForm(createCandidateFromCv);
  const [state, action, actionPending] = useServerForm(createCandidate);
  const cancelHref = roleId ? `/roles/${roleId}` : "/candidates";

  const roleSelect = (
    <Field label="Add to role">
      <Select name="roleId" value={role} onChange={(e) => setRole(e.target.value)}>
        <option value="">Not now</option>
        {roles.map((r) => (
          <option key={r.id} value={r.id}>{r.title}</option>
        ))}
      </Select>
    </Field>
  );

  return (
    <>
      <div className="mb-4 inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
        {(["upload", "manual"] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx("rounded-md px-3 py-1.5 text-[13px] font-medium", tab === t ? "bg-ink text-white" : "text-muted hover:text-ink")}
          >
            {t === "upload" ? "Upload CV" : "Enter manually"}
          </button>
        ))}
      </div>

      {tab === "upload" ? (
        <ActionForm action={cvAction} pending={cvActionPending} className="space-y-5">
          <Card className="space-y-4 p-6">
            <SectionTitle hint="PDF or DOCX, up to 4 MB. Stored privately in your workspace.">Upload a CV</SectionTitle>
            <p className="text-[13px] text-muted">
              Talyn reads the CV and extracts contact details, work history, education, skills and certifications — each with the CV text it came from. You
              review and correct everything before it&apos;s used. Contact details are read locally and never sent to an AI provider.
              {!aiConfigured && " AI is off, so a basic parser (not AI) will extract what it can."}
            </p>
            <Input name="cv" type="file" required accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="h-auto py-1.5" />
            <div className="max-w-sm">{roleSelect}</div>
            {cvState?.error && (
              <Notice tone="danger">
                {cvState.error}{" "}
                <button type="button" onClick={() => setTab("manual")} className="font-medium underline">
                  Enter details manually
                </button>
              </Notice>
            )}
          </Card>
          <div className="flex items-center gap-3">
            <div className="ml-auto flex gap-2">
              <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
              <SubmitButton pendingLabel="Reading CV and extracting details…">Upload and extract</SubmitButton>
            </div>
          </div>
        </ActionForm>
      ) : (
        <ActionForm action={action} pending={actionPending} className="space-y-5">
          {cvState?.error && <Notice tone="warn">The CV couldn&apos;t be read ({cvState.error.split(".")[0].toLowerCase()}). Enter the details below instead.</Notice>}
          <Card className="p-6">
            <SectionTitle hint="Everything entered here is recorded as recruiter-entered.">Profile</SectionTitle>
            <CandidateFields />
          </Card>
          <Card className="p-6">
            <SectionTitle hint="Optional. PDF, DOCX or TXT up to 4 MB — or paste the text.">Resume</SectionTitle>
            <div className="space-y-4">
              <Input name="resume" type="file" accept=".pdf,.docx,.txt,.md" className="h-auto py-1.5" />
              <Field label="…or paste resume text">
                <Textarea name="resumeText" rows={5} maxLength={100000} />
              </Field>
            </div>
          </Card>
          <Card className="grid gap-4 p-6 sm:grid-cols-2">
            {roleSelect}
            <Field label="Recruiter note" hint="Private to your team. Never used as assessment evidence." className="sm:col-span-2">
              <Textarea name="note" rows={2} maxLength={10000} />
            </Field>
          </Card>
          <div className="flex items-center gap-3">
            <FormMessage state={state} />
            <div className="ml-auto flex gap-2">
              <LinkButton href={cancelHref} variant="ghost">Cancel</LinkButton>
              <SubmitButton pendingLabel="Saving…">Add candidate</SubmitButton>
            </div>
          </div>
        </ActionForm>
      )}
    </>
  );
}
