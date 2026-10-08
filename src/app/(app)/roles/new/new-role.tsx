"use client";

import clsx from "clsx";
import { useState } from "react";
import { JdUploadFlow } from "@/components/upload-flows";
import { createRole } from "@/server/role-actions";
import { RoleForm } from "../role-form";

export function NewRole({ initialMode }: { initialMode: "upload" | "manual" }) {
  const [mode, setMode] = useState(initialMode);
  return (
    <>
      <div role="tablist" aria-label="How to create the role" className="mb-4 inline-flex rounded-lg border border-line-strong bg-surface p-0.5">
        {(["upload", "manual"] as const).map((t) => (
          <button
            key={t}
            role="tab"
            aria-selected={mode === t}
            type="button"
            onClick={() => setMode(t)}
            className={clsx("rounded-md px-3 py-1.5 text-[13px] font-medium transition-colors", mode === t ? "bg-ink text-white" : "text-muted hover:text-ink")}
          >
            {t === "upload" ? "From a job description" : "Enter manually"}
          </button>
        ))}
      </div>
      <div key={mode} className="motion-fade">
        {mode === "upload" ? (
          <JdUploadFlow onCancelHref="/roles" manualHref="/roles/new?mode=manual" />
        ) : (
          <RoleForm action={createRole} submitLabel="Create role" cancelHref="/roles" />
        )}
      </div>
    </>
  );
}
