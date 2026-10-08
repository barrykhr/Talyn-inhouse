"use client";

import clsx from "clsx";
import { useState } from "react";
import { CandidateFields } from "@/components/candidate-fields";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Card, Field, Input, LinkButton, Notice, Select, SectionTitle, Textarea } from "@/components/ui";
import { CvUploadFlow, type RoleOption } from "@/components/upload-flows";
import { createCandidate } from "@/server/candidate-actions";

export function NewCandidateForm({ roles, roleId, aiConfigured }: { roles: RoleOption[]; roleId: string; aiConfigured: boolean }) {
  const [tab, setTab] = useState<"upload" | "manual">("upload");
  const [role, setRole] = useState(roleId);
  const [cvError, setCvError] = useState<string | null>(null);
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
      <div role="tablist" aria-label="How to add the candidate" className="mb-4 inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
        {(["upload", "manual"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={tab === t}
            type="button"
            onClick={() => setTab(t)}
            className={clsx("rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", tab === t ? "bg-ink text-white" : "text-muted hover:text-ink")}
          >
            {t === "upload" ? "From a CV" : "Enter manually"}
          </button>
        ))}
      </div>

      <div key={tab} className="motion-fade">
      {tab === "upload" ? (
        <CvUploadFlow
          roles={roles}
          defaultRole={roleId}
          aiConfigured={aiConfigured}
          onManual={(err) => {
            setCvError(err ?? null);
            setTab("manual");
          }}
        />
      ) : (
        <ActionForm action={action} pending={actionPending} className="space-y-5">
          {cvError && <Notice tone="warn">The CV couldn&apos;t be used: {cvError} Enter the details below instead.</Notice>}
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
      </div>
    </>
  );
}
