"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { DiscoverJdFlow } from "@/components/upload-flows";
import { Card } from "@/components/ui";
import { EMPTY_BRIEF } from "@/lib/discovery/brief";
import { startManualDiscovery } from "@/server/discovery-actions";
import { BriefFieldsEditor } from "../brief-fields";

/** Two ways in: a JD to extract from, or the same fields entered by hand. */
export function NewDiscovery({ roles }: { roles: { id: string; title: string }[] }) {
  const [mode, setMode] = useState<"jd" | "manual">("jd");
  const [state, action, pending] = useServerForm(startManualDiscovery);
  return (
    <div className="space-y-4">
      <div role="tablist" aria-label="How to start" className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5 text-[13.5px]">
        {(
          [
            ["jd", "Upload a job description"],
            ["manual", "Enter role details"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            role="tab"
            type="button"
            aria-selected={mode === k}
            onClick={() => setMode(k)}
            className={clsx("rounded-md px-3 py-1.5 font-medium", mode === k ? "bg-ink text-white" : "text-muted hover:text-ink")}
          >
            {label}
          </button>
        ))}
      </div>

      {mode === "jd" ? (
        <Card className="p-5">
          <p className="mb-3 text-[13px] text-ink-2">
            Talyn creates a draft role, keeps the JD, and suggests the role name, required and preferred skills, years of experience, location, work arrangement and a Boolean query. You review and edit
            every field before anything is searched.
          </p>
          <DiscoverJdFlow />
        </Card>
      ) : (
        <Card className="p-5">
          <ActionForm action={action} pending={pending} className="space-y-4">
            <BriefFieldsEditor initial={EMPTY_BRIEF} showProvenance={false} />
            <FormMessage state={state} />
            <div className="flex items-center gap-2">
              <span className="text-[12.5px] text-muted">Creates a draft role with these fields. You choose sources on the next screen.</span>
              <SubmitButton className="ml-auto" pendingLabel="Creating…">
                Create and continue
              </SubmitButton>
            </div>
          </ActionForm>
        </Card>
      )}

      {roles.length > 0 && (
        <p className="text-[13px] text-muted">
          Sourcing for a role you already have?{" "}
          {roles.slice(0, 6).map((r, i) => (
            <span key={r.id}>
              {i > 0 && " · "}
              <Link href={`/roles/${r.id}/discover`} className="font-medium text-ink-2 underline-offset-2 hover:underline">
                {r.title}
              </Link>
            </span>
          ))}
          {roles.length > 6 && (
            <>
              {" · "}
              <Link href="/discover" className="underline">
                all roles
              </Link>
            </>
          )}
        </p>
      )}
    </div>
  );
}
