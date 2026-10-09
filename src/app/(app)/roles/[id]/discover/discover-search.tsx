"use client";

import clsx from "clsx";
import { useState } from "react";
import { ActionForm, FormMessage, SubmitButton, usePendingTask, useServerForm } from "@/components/client";
import { StagedProgress } from "@/components/staged-progress";
import { Field, Input, Notice } from "@/components/ui";
import type { SearchFilters } from "@/lib/sourcing/filters";
import { discoverSearch, importSourcingFile, planSearch } from "@/server/sourcing-actions";

export type SourceOption = { key: string; label: string; kind: string; available: boolean; note: string };

const join = (xs: string[]) => xs.join(", ");

/**
 * The recruiter's search: a query plus role-relevant filters, run on a chosen source. Each search
 * is saved as a new version. Nothing runs until the recruiter presses Search.
 */
export function DiscoverSearch({
  roleId,
  initial,
  initialFrom,
  sources,
  defaultSource,
  canPlanFromProfile,
}: {
  roleId: string;
  initial: SearchFilters;
  initialFrom: string;
  sources: SourceOption[];
  defaultSource: string;
  canPlanFromProfile: boolean;
}) {
  const [f, setF] = useState(() => ({
    q: join(initial.keywords),
    titles: join(initial.titles),
    adjacent: join(initial.adjacent_titles),
    skills: join(initial.skills_required),
    nice: join(initial.skills_preferred),
    locations: join(initial.locations),
    seniority: join(initial.seniority),
    exclusions: join(initial.exclusions),
  }));
  const [from, setFrom] = useState(initialFrom);
  const [generator, setGenerator] = useState("recruiter");
  const [source, setSource] = useState(defaultSource);
  const [state, action, pending] = useServerForm(discoverSearch.bind(null, roleId));
  const [planning, startPlanning] = usePendingTask();
  const [planNote, setPlanNote] = useState<string | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value });
  const chosen = sources.find((s) => s.key === source);

  return (
    <ActionForm action={action} pending={pending} className="space-y-4 rounded-[var(--radius-card)] border border-line bg-surface p-4 sm:p-5">
      <input type="hidden" name="generator" value={generator} />
      <Field label="Search query" hint="Terms that should appear in the profile, separated by commas — e.g. payments, PostgreSQL, on-call.">
        <Input name="q" value={f.q} onChange={set("q")} maxLength={1000} placeholder="e.g. payments, PostgreSQL, Kubernetes" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Job titles">
          <Input name="f_titles" value={f.titles} onChange={set("titles")} placeholder="e.g. Backend Engineer, Software Engineer" />
        </Field>
        <Field label="Adjacent titles" hint="Related roles that may have transferable experience.">
          <Input name="f_adjacent_titles" value={f.adjacent} onChange={set("adjacent")} placeholder="e.g. Site Reliability Engineer" />
        </Field>
        <Field label="Skills">
          <Input name="f_skills_required" value={f.skills} onChange={set("skills")} placeholder="e.g. Go, PostgreSQL" />
        </Field>
        <Field label="Nice-to-have skills">
          <Input name="f_skills_preferred" value={f.nice} onChange={set("nice")} placeholder="e.g. Kafka, AWS" />
        </Field>
        <Field label="Location">
          <Input name="f_locations" value={f.locations} onChange={set("locations")} placeholder="e.g. Berlin, Remote — EU" />
        </Field>
        <Field label="Seniority" hint="Matched against title text only — often not established by the source.">
          <Input name="f_seniority" value={f.seniority} onChange={set("seniority")} placeholder="e.g. Senior, Staff" />
        </Field>
      </div>
      <details className="text-[13px]">
        <summary className="cursor-pointer text-muted hover:text-ink">Exclusions</summary>
        <div className="mt-2">
          <Field label="Exclude profiles mentioning" hint="Job-related only. Matching profiles are set aside for you to see, never deleted.">
            <Input name="f_exclusions" value={f.exclusions} onChange={set("exclusions")} />
          </Field>
        </div>
      </details>

      <fieldset>
        <legend className="mb-1.5 text-[13px] font-medium">Source</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {sources.map((s) => (
            <label
              key={s.key}
              className={clsx(
                "flex cursor-pointer flex-col gap-0.5 rounded-lg border p-2.5 text-[12.5px]",
                !s.available && "cursor-not-allowed opacity-60",
                source === s.key ? "border-ink bg-sunken" : "border-line-strong hover:bg-sunken/60",
              )}
            >
              <span className="flex items-center gap-2 font-medium text-ink">
                <input type="radio" name="source" value={s.key} checked={source === s.key} disabled={!s.available} onChange={() => setSource(s.key)} />
                {s.label}
              </span>
              <span className="text-muted">{s.note}</span>
            </label>
          ))}
        </div>
      </fieldset>

      {chosen?.kind === "sample" && <Notice tone="warn">Sample data: results are fictional people from a fixed example list. This is not a live search and nobody is contacted.</Notice>}
      {pending && (
        <StagedProgress
          stages={[
            { key: "save", label: "Saving your search as a new version", state: "done" },
            { key: "run", label: chosen?.kind === "sample" ? "Matching against sample profiles" : `Searching ${chosen?.label ?? "the source"}`, state: "active", slow: chosen?.kind === "external" },
          ]}
        />
      )}
      <FormMessage state={state} />
      <div className="flex flex-wrap items-center gap-2">
        <SubmitButton pendingLabel="Searching…">Search</SubmitButton>
        {canPlanFromProfile && (
          <button
            type="button"
            disabled={planning}
            onClick={() =>
              startPlanning(async () => {
                const r = await planSearch(roleId, f.q);
                if (r.error || !r.plan) return setPlanNote(r.error ?? "Couldn't build a plan.");
                const p = r.plan.filters;
                setF({ ...f, titles: join(p.titles), adjacent: join(p.adjacent_titles), skills: join(p.skills_required), nice: join(p.skills_preferred), locations: join(p.locations), seniority: join(p.seniority), exclusions: join(p.exclusions) });
                setGenerator(r.plan.generator);
                setFrom(r.plan.generator.startsWith("ai:") ? "Filled by AI from the approved Ideal Candidate Profile — review before searching" : "Filled from the approved Ideal Candidate Profile");
                setPlanNote(r.notice ?? null);
              })
            }
            className="h-9 rounded-lg px-3 text-[13px] font-medium text-muted hover:bg-sunken hover:text-ink disabled:opacity-50"
          >
            {planning ? "Filling…" : "Fill from Ideal Candidate Profile"}
          </button>
        )}
        <span className="text-[12px] text-faint">{from}</span>
      </div>
      {planNote && <p className="text-[12.5px] text-muted">{planNote}</p>}
    </ActionForm>
  );
}

/** Import profiles exported from a source the organization is licensed to use. */
export function ImportExportForm({ strategyId, version }: { strategyId: string; version: number }) {
  const [state, action, pending] = useServerForm(importSourcingFile.bind(null, strategyId));
  return (
    <ActionForm action={action} pending={pending} className="space-y-3">
      <p className="text-[12.5px] text-muted">
        CSV from a tool or list your organization is licensed to use for recruiting (for example an export from a recruiting product, an event list with consent, or referrals). Columns:{" "}
        <code className="font-mono">name</code> (required), <code className="font-mono">title</code>, <code className="font-mono">company</code>, <code className="font-mono">location</code>,{" "}
        <code className="font-mono">email</code>, <code className="font-mono">linkedin_url</code>, <code className="font-mono">profile_url</code>, <code className="font-mono">skills</code>,{" "}
        <code className="font-mono">summary</code>, <code className="font-mono">updated_at</code>. Rows are matched against search v{version}; contact details are kept only if the file has them.
      </p>
      <Field label="Source">
        <Input name="sourceName" required maxLength={120} placeholder="e.g. Recruiting tool export, Spring career fair sign-ups" />
      </Field>
      <Field label="File (.csv, up to 1,000 rows)">
        <Input name="file" type="file" accept=".csv,text/csv" required />
      </Field>
      <label className="flex items-start gap-2 text-[12.5px]">
        <input type="checkbox" name="attest" className="mt-0.5" required />
        <span>I confirm my organization is licensed or has consent to use this data for recruiting, and the source&apos;s terms allow this use.</span>
      </label>
      <FormMessage state={state} />
      <SubmitButton variant="secondary" pendingLabel="Importing…">
        Import and match
      </SubmitButton>
    </ActionForm>
  );
}
