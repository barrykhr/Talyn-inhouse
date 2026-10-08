"use client";

import clsx from "clsx";
import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Card, Input, LinkButton, Notice } from "@/components/ui";
import { createRoleFromJd } from "@/server/jd-actions";
import { createRole } from "@/server/role-actions";
import { RoleForm } from "../role-form";

export function NewRole({ aiConfigured }: { aiConfigured: boolean }) {
  const [tab, setTab] = useState<"upload" | "manual">("upload");
  const [state, action, actionPending] = useServerForm(createRoleFromJd);
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
            {t === "upload" ? "Upload job description" : "Enter manually"}
          </button>
        ))}
      </div>
      {tab === "upload" ? (
        <Card className="space-y-4 p-6">
          <div>
            <h2 className="font-semibold">Upload a job description</h2>
            <p className="mt-1 text-[13px] text-muted">
              PDF or DOCX, up to 4 MB. Talyn keeps the file, extracts the role details and proposes criteria — with the source text for each. Nothing is applied
              until you review it.
              {!aiConfigured && " AI is off, so a basic parser (not AI) will extract what it can."}
            </p>
          </div>
          <ActionForm action={action} pending={actionPending} className="space-y-4">
            <Input name="jd" type="file" required accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document" className="h-auto py-1.5" />
            {state?.error && (
              <Notice tone="danger">
                {state.error}{" "}
                <button type="button" onClick={() => setTab("manual")} className="font-medium underline">
                  Enter details manually
                </button>
              </Notice>
            )}
            <div className="flex items-center gap-2">
              <FormMessage state={state?.error ? undefined : state} />
              <div className="ml-auto flex gap-2">
                <LinkButton href="/roles" variant="ghost">Cancel</LinkButton>
                <SubmitButton pendingLabel="Reading the JD and extracting details…">Upload and extract</SubmitButton>
              </div>
            </div>
          </ActionForm>
        </Card>
      ) : (
        <RoleForm action={createRole} submitLabel="Create role" cancelHref="/roles" />
      )}
    </>
  );
}
