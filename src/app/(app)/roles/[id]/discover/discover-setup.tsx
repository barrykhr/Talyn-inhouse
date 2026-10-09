"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { StagedProgress } from "@/components/staged-progress";
import { Notice } from "@/components/ui";
import type { BriefFields, Provenance } from "@/lib/discovery/brief";
import { saveBriefAndSearch } from "@/server/discovery-actions";
import { BriefFieldsEditor } from "../../../discover/brief-fields";

export type SourceOption = { key: string; label: string; kind: "internal" | "external" | "sample"; configured: boolean; note: string };

/**
 * Review the search fields, pick sources, then save or search. Live sources and demo mode are
 * separate choices so sample people never mix with real search results.
 */
export function DiscoverSetupForm({
  roleId,
  fields,
  provenance,
  booleanQuery,
  booleanEdited,
  booleanKey,
  sources,
  confirmed,
}: {
  roleId: string;
  fields: BriefFields;
  provenance: Provenance;
  booleanQuery?: string;
  booleanEdited: boolean;
  booleanKey: string | null;
  sources: SourceOption[];
  confirmed: boolean;
}) {
  const [state, action, pending] = useServerForm(saveBriefAndSearch.bind(null, roleId));
  const live = sources.filter((s) => s.kind !== "sample");
  const demo = sources.find((s) => s.kind === "sample");
  const [mode, setMode] = useState<"live" | "demo">("live");
  const [picked, setPicked] = useState<string[]>(live.filter((s) => s.configured).map((s) => s.key));
  const liveCount = picked.length;

  return (
    <ActionForm action={action} pending={pending} className="space-y-5">
      <BriefFieldsEditor initial={fields} provenance={provenance} initialBoolean={booleanQuery} initialBooleanEdited={booleanEdited} initialBooleanKey={booleanKey} />

      <fieldset className="space-y-2">
        <legend className="mb-1 text-[13px] font-medium">Search in</legend>
        <div role="radiogroup" aria-label="Search mode" className="inline-flex rounded-lg border border-line-strong bg-surface p-0.5 text-[13px]">
          <button type="button" role="radio" aria-checked={mode === "live"} onClick={() => setMode("live")} className={clsx("rounded-md px-3 py-1 font-medium", mode === "live" ? "bg-ink text-white" : "text-muted hover:text-ink")}>
            Connected sources
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={mode === "demo"}
            disabled={!demo?.configured}
            onClick={() => setMode("demo")}
            title={demo?.configured ? undefined : "Off — a live source is connected"}
            className={clsx("rounded-md px-3 py-1 font-medium disabled:opacity-50", mode === "demo" ? "bg-warn text-white" : "text-muted hover:text-ink")}
          >
            Demo mode
          </button>
        </div>
        <input type="hidden" name="mode" value={mode} />
        {mode === "live" ? (
          <ul className="grid gap-2 sm:grid-cols-2">
            {live.map((s) => (
              <li key={s.key}>
                <label className={clsx("flex h-full gap-2.5 rounded-lg border p-2.5 text-[12.5px]", s.configured ? "cursor-pointer border-line-strong hover:bg-sunken/60" : "border-dashed border-line-strong opacity-75")}>
                  <input
                    type="checkbox"
                    name="source"
                    value={s.key}
                    disabled={!s.configured}
                    checked={picked.includes(s.key)}
                    onChange={(e) => setPicked(e.target.checked ? [...picked, s.key] : picked.filter((k) => k !== s.key))}
                    className="mt-0.5"
                  />
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-1.5 font-medium text-ink">
                      {s.label}
                      <span className={clsx("rounded px-1.5 py-px text-[11px] font-medium", s.configured ? "bg-ok-soft text-ok" : "bg-sunken text-muted")}>{s.configured ? "Connected" : "Not connected"}</span>
                    </span>
                    <span className="block text-muted">{s.note}</span>
                    {!s.configured && (
                      <Link href="/integrations" className="font-medium underline">
                        Set up in Integrations
                      </Link>
                    )}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <Notice tone="warn">
            <strong>Demo mode.</strong> Searches a fixed list of fictional sample people so you can try the workflow. It is not a live search, results are labeled as samples everywhere, and none of
            them can be contacted.
          </Notice>
        )}
      </fieldset>

      {pending && (
        <StagedProgress
          stages={[
            { key: "save", label: "Saving your reviewed fields", state: "done" },
            { key: "run", label: mode === "demo" ? "Matching against sample people" : `Searching ${liveCount} source${liveCount === 1 ? "" : "s"}`, state: "active", slow: mode === "live" && picked.includes("external") },
            { key: "merge", label: "Merging people found in more than one source", state: "pending" },
          ]}
        />
      )}
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton name="intent" value="search" pendingLabel="Searching…">
          {mode === "demo" ? "Run demo search" : `Search ${liveCount || ""} source${liveCount === 1 ? "" : "s"}`.replace("  ", " ")}
        </SubmitButton>
        <SubmitButton name="intent" value="save" variant="secondary" pendingLabel="Saving…">
          Save fields only
        </SubmitButton>
        <span className="text-[12px] text-muted">{confirmed ? "Searching saves any changes first." : "Review the fields — they're confirmed when you save or search."}</span>
      </div>
    </ActionForm>
  );
}
