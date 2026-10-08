"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionButton, ActionForm, FormMessage, SubmitButton, usePendingTask, useServerForm } from "@/components/client";
import { StagedProgress } from "@/components/staged-progress";
import { useToast } from "@/components/toast";
import { Button, Card, Field, Input, Notice, Textarea } from "@/components/ui";
import { FILTER_LABEL, toBoolean, parseList, type SearchFilters } from "@/lib/sourcing/filters";
import { importSourcingFile, planSearch, runSearch, saveStrategy, type PlanResult } from "@/server/sourcing-actions";

type Plan = NonNullable<PlanResult["plan"]>;

export function StrategyPlanner({ roleId, nextVersion, aiConfigured }: { roleId: string; nextVersion: number; aiConfigured: boolean }) {
  const [request, setRequest] = useState("");
  const [planning, startPlanning] = usePendingTask();
  const [result, setResult] = useState<PlanResult | null>(null);
  return (
    <Card className="space-y-4 p-5">
      <Field label="Describe who you're looking for (optional)" hint="Plain language. Talyn maps each phrase to a filter and shows you how — nothing runs until you save and run it.">
        <Textarea
          value={request}
          onChange={(e) => setRequest(e.target.value)}
          rows={2}
          maxLength={2000}
          placeholder="e.g. Backend engineers in Berlin or remote-EU who've run Postgres at scale; fintech is a plus"
        />
      </Field>
      <div className="flex items-center gap-2">
        <Button variant={aiConfigured ? "signal" : "secondary"} disabled={planning} onClick={() => startPlanning(async () => setResult(await planSearch(roleId, request)))}>
          {result?.plan ? "Re-plan" : "Plan search"}
        </Button>
        <span className="text-[12.5px] text-muted">{aiConfigured ? "Uses the approved profile plus your request." : "AI is off: the plan is built from the approved profile only."}</span>
      </div>
      {planning && <StagedProgress stages={[{ key: "plan", label: "Mapping the profile and your request to filters", state: "active", slow: true }]} />}
      {result?.error && <Notice tone="danger">{result.error}</Notice>}
      {result?.plan && <PlanEditor key={JSON.stringify(result.plan.filters)} roleId={roleId} plan={result.plan} request={request} notice={result.notice} nextVersion={nextVersion} />}
    </Card>
  );
}

function PlanEditor({ roleId, plan, request, notice, nextVersion }: { roleId: string; plan: Plan; request: string; notice?: string; nextVersion: number }) {
  const [filters, setFilters] = useState<SearchFilters>(plan.filters);
  const [bool, setBool] = useState(plan.boolean);
  const [boolEdited, setBoolEdited] = useState(false);
  const [state, action, pending] = useServerForm(saveStrategy.bind(null, roleId));
  const router = useRouter();
  const toast = useToast();
  useEffect(() => {
    if (!boolEdited) setBool(toBoolean(filters));
  }, [filters, boolEdited]);
  useEffect(() => {
    if (state?.ok) {
      toast({ message: state.message ?? "Search saved" });
      router.refresh();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <ActionForm action={action} pending={pending} className="space-y-4 border-t border-line pt-4">
      {notice && <Notice tone="warn">{notice}</Notice>}
      <input type="hidden" name="request" value={request} />
      <input type="hidden" name="generator" value={plan.generator} />
      <input type="hidden" name="mappingJson" value={JSON.stringify(plan.mapping)} />
      <input type="hidden" name="explanationsJson" value={JSON.stringify(plan.explanations)} />
      <input type="hidden" name="planJson" value={JSON.stringify(plan.plan)} />

      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(FILTER_LABEL) as (keyof SearchFilters)[]).map((k) => (
          <Field key={k} label={FILTER_LABEL[k]} hint={k === "exclusions" ? "Job-related only. Matching profiles are set aside (still viewable), never deleted." : undefined}>
            <Textarea
              name={`f_${k}`}
              rows={1}
              value={filters[k].join(", ")}
              onChange={(e) => setFilters((f) => ({ ...f, [k]: parseList(e.target.value) }))}
              className="min-h-9 text-[13px]"
              placeholder="Comma-separated"
            />
          </Field>
        ))}
      </div>

      <Field label="Boolean query" hint="Generic syntax for review and export. Each source applies its own syntax — see the source notes when you run it.">
        <Textarea
          name="booleanQuery"
          rows={2}
          value={bool}
          onChange={(e) => {
            setBool(e.target.value);
            setBoolEdited(true);
          }}
          className="font-mono text-[12.5px]"
        />
      </Field>
      {boolEdited && (
        <button type="button" onClick={() => setBoolEdited(false)} className="text-[12.5px] text-muted underline-offset-2 hover:text-ink hover:underline">
          Rebuild Boolean from filters
        </button>
      )}

      <details className="rounded-lg border border-line p-3 text-[13px]" open>
        <summary className="cursor-pointer font-medium">How each phrase became a filter</summary>
        <table className="mt-2 w-full text-[12.5px]">
          <thead className="text-left text-muted">
            <tr>
              <th className="py-1 pr-3 font-medium">Phrase</th>
              <th className="py-1 pr-3 font-medium">Became</th>
              <th className="py-1 font-medium">Why</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {plan.mapping.map((m, i) => (
              <tr key={i}>
                <td className="py-1 pr-3">“{m.phrase}”</td>
                <td className="py-1 pr-3 whitespace-nowrap">{m.field === "not_used" ? <span className="text-faint">not used</span> : `${FILTER_LABEL[m.field as keyof SearchFilters]}: ${m.value}`}</td>
                <td className="py-1 text-muted">{m.note}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {plan.explanations.length > 0 && (
          <ul className="mt-3 space-y-0.5 text-[12.5px]">
            {plan.explanations.map((e, i) => (
              <li key={i}>
                <span className="font-medium">{e.term}</span> <span className="text-muted">— {e.why}</span>
              </li>
            ))}
          </ul>
        )}
      </details>

      {(plan.plan.target_titles.length > 0 || plan.plan.notes) && (
        <div className="rounded-lg bg-[#fbfaf8] p-3 text-[13px]">
          <div className="mb-1 font-medium">Sourcing plan</div>
          {plan.plan.target_titles.length > 0 && <p><span className="text-muted">Target titles:</span> {plan.plan.target_titles.join(", ")}</p>}
          {plan.plan.adjacent_profiles.length > 0 && <p><span className="text-muted">Adjacent profiles:</span> {plan.plan.adjacent_profiles.join(", ")}</p>}
          {plan.plan.company_contexts.length > 0 && <p><span className="text-muted">Company contexts:</span> {plan.plan.company_contexts.join(", ")}</p>}
          {plan.plan.notes && <p className="mt-1 text-ink-2">{plan.plan.notes}</p>}
          <p className="mt-1 text-[11.5px] text-faint">Any market observations here are estimates, not verified labor-market data.</p>
        </div>
      )}

      <div className="flex items-center gap-2">
        <FormMessage state={state?.ok ? undefined : state} />
        <SubmitButton className="ml-auto" pendingLabel="Saving…">
          Save as search v{nextVersion}
        </SubmitButton>
      </div>
    </ActionForm>
  );
}

export function RunSearchButton({ strategyId, sourceKey, label, disabled }: { strategyId: string; sourceKey: string; label: string; disabled?: boolean }) {
  return (
    <ActionButton action={() => runSearch(strategyId, sourceKey)} variant="secondary" pendingLabel="Searching…" successMessage="Search complete — results are ready for review">
      {disabled ? `${label} (not connected)` : label}
    </ActionButton>
  );
}

/** Import profiles exported from a source the organization is licensed to use. */
export function ImportExportForm({ strategyId, version }: { strategyId: string; version: number }) {
  const [state, action, pending] = useServerForm(importSourcingFile.bind(null, strategyId));
  return (
    <details className="mt-2 text-[12.5px]">
      <summary className="cursor-pointer text-muted">Import an authorized export</summary>
      <ActionForm action={action} pending={pending} className="mt-2 space-y-3 rounded-lg bg-sunken p-3">
        <p className="text-muted">
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
        <label className="flex items-start gap-2">
          <input type="checkbox" name="attest" className="mt-0.5" required />
          <span>I confirm my organization is licensed or has consent to use this data for recruiting, and the source&apos;s terms allow this use.</span>
        </label>
        <FormMessage state={state} />
        <SubmitButton variant="secondary" pendingLabel="Importing…">
          Import and match
        </SubmitButton>
      </ActionForm>
    </details>
  );
}
