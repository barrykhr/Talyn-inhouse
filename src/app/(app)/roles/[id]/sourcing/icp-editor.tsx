"use client";

import clsx from "clsx";
import { useState } from "react";
import { ActionButton, ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { AiMark, Input, Textarea } from "@/components/ui";
import { ICP_CATEGORIES, ICP_ORIGIN_LABEL } from "@/lib/domain";
import { generateIcp, reviseIcp, saveIcp } from "@/server/icp-actions";

export type IcpItemView = {
  id: string;
  category: string;
  value: string;
  origin: string;
  rationale: string | null;
  sourceQuote: string | null;
  sourcePage: number | null;
  status: string;
  edited: boolean;
};
export type IcpView = {
  id: string;
  version: number;
  status: string;
  generator: string;
  criteriaVersion: number;
  approvedByName: string | null;
  approvedAt: string | null;
  clarifications: { question: string; why: string; answer?: string }[];
  items: IcpItemView[];
};

function OriginTag({ origin }: { origin: string }) {
  if (origin === "ai_inferred") return <AiMark label="Inferred" />;
  return <span className="text-[11.5px] text-faint">{ICP_ORIGIN_LABEL[origin] ?? origin}</span>;
}

export function GenerateIcpButton({ roleId, label, aiConfigured }: { roleId: string; label: string; aiConfigured: boolean }) {
  return (
    <ActionButton action={() => generateIcp(roleId)} variant={aiConfigured ? "signal" : "secondary"} size="md" pendingLabel="Building the profile…" successMessage="Draft profile ready for review">
      {label}
    </ActionButton>
  );
}

export function IcpDraftEditor({ icp, roleCriteriaVersion }: { icp: IcpView; roleCriteriaVersion: number }) {
  const [state, action, pending] = useServerForm(saveIcp.bind(null, icp.id));
  const [added, setAdded] = useState<Record<string, number>>({});
  return (
    <ActionForm action={action} pending={pending} className="space-y-4">
      {icp.criteriaVersion !== roleCriteriaVersion && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">The role&apos;s criteria changed after this draft was generated. Regenerate it, or review carefully.</p>
      )}
      {icp.clarifications.length > 0 && (
        <div className="rounded-xl border border-[#f3cdbb] bg-[#fffaf6] p-4">
          <div className="mb-1 text-[13px] font-semibold">Questions before you search</div>
          <p className="mb-3 text-[12.5px] text-muted">Talyn found things that are vague, conflicting or missing. They are not turned into filters — answer them here and adjust the profile yourself.</p>
          <ol className="space-y-3">
            {icp.clarifications.map((c, i) => (
              <li key={i} className="text-[13px]">
                <div className="font-medium">{c.question}</div>
                <div className="text-[12px] text-muted">{c.why}</div>
                <Textarea name={`answer_${i}`} rows={1} defaultValue={c.answer ?? ""} placeholder="Your answer (optional, for the team)" className="mt-1 min-h-8 text-[13px]" />
              </li>
            ))}
          </ol>
        </div>
      )}

      {ICP_CATEGORIES.map((cat) => {
        const items = icp.items.filter((i) => i.category === cat.key);
        const n = added[cat.key] ?? 0;
        return (
          <fieldset key={cat.key} className="rounded-xl border border-line bg-surface p-4">
            <legend className="sr-only">{cat.label}</legend>
            <div className="mb-2 flex items-baseline justify-between gap-3">
              <div>
                <span className="text-[13px] font-semibold">{cat.label}</span>
                <span className="ml-2 text-[12px] text-muted">{cat.hint}</span>
              </div>
              <button type="button" onClick={() => setAdded((a) => ({ ...a, [cat.key]: n + 1 }))} className="text-[12.5px] font-medium text-muted hover:text-ink">
                + Add
              </button>
            </div>
            {items.length === 0 && n === 0 && <p className="text-[12.5px] text-faint">None.</p>}
            <div className="space-y-2">
              {items.map((it) => (
                <div key={it.id} className={clsx("flex items-start gap-2", cat.key === "exclusion" && "rounded-lg bg-danger-soft/40 p-1.5")}>
                  <input type="checkbox" name={`use_${it.id}`} defaultChecked={it.status === "approved"} className="mt-2 accent-[var(--color-ink)]" aria-label={`Use ${it.value}`} />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Input name={`value_${it.id}`} defaultValue={it.value} className="h-8 text-[13px]" />
                      <span className="shrink-0">
                        <OriginTag origin={it.origin} />
                      </span>
                    </div>
                    {(it.rationale || it.sourceQuote) && (
                      <details className="mt-0.5 text-[12px] text-muted">
                        <summary className="cursor-pointer">Why</summary>
                        {it.rationale && <p>{it.rationale}</p>}
                        {it.sourceQuote && (
                          <p className="quote mt-1 border-l-2 border-line-strong pl-2 text-ink-2">
                            “{it.sourceQuote}”{it.sourcePage ? ` — JD p.${it.sourcePage}` : ""}
                          </p>
                        )}
                      </details>
                    )}
                  </div>
                </div>
              ))}
              {Array.from({ length: n }).map((_, i) => (
                <Input key={i} name={`new_${cat.key}_${i}`} placeholder={`Add ${cat.label.toLowerCase()}`} className="h-8 text-[13px]" autoFocus={i === n - 1} />
              ))}
            </div>
            {cat.key === "exclusion" && <p className="mt-2 text-[11.5px] text-muted">Exclusions remove people from results. Keep them strictly job-related; they are off unless you tick them.</p>}
          </fieldset>
        );
      })}

      <div className="sticky bottom-3 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-surface/95 px-4 py-3 shadow-sm backdrop-blur">
        <FormMessage state={state} />
        <div className="ml-auto flex gap-2">
          <SubmitButton size="sm" variant="secondary" name="intent" value="save" pendingLabel="Saving…">
            Save draft
          </SubmitButton>
          <SubmitButton size="sm" name="intent" value="approve" pendingLabel="Saving…">
            Approve profile
          </SubmitButton>
        </div>
      </div>
    </ActionForm>
  );
}

export function IcpApprovedView({ icp, roleCriteriaVersion }: { icp: IcpView; roleCriteriaVersion: number }) {
  const approved = icp.items.filter((i) => i.status === "approved");
  return (
    <div className="space-y-3">
      {icp.criteriaVersion !== roleCriteriaVersion && (
        <p className="rounded-lg bg-warn-soft px-3 py-2 text-[13px] text-warn">The role&apos;s criteria changed after this profile was approved. Consider revising it.</p>
      )}
      <dl className="grid gap-x-6 gap-y-3 sm:grid-cols-2">
        {ICP_CATEGORIES.map((cat) => {
          const items = approved.filter((i) => i.category === cat.key);
          if (!items.length) return null;
          return (
            <div key={cat.key}>
              <dt className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">{cat.label}</dt>
              <dd className="mt-1 flex flex-wrap gap-1.5">
                {items.map((i) => (
                  <span
                    key={i.id}
                    title={`${ICP_ORIGIN_LABEL[i.origin] ?? i.origin}${i.edited ? " · edited" : ""}${i.rationale ? ` — ${i.rationale}` : ""}`}
                    className={clsx("rounded-md border px-2 py-0.5 text-[12.5px]", cat.key === "exclusion" ? "border-[#f1c9c4] text-danger" : "border-line-strong text-ink-2")}
                  >
                    {i.value}
                    {i.origin === "ai_inferred" && <span className="ml-1 text-signal" aria-label="inferred by AI">✦</span>}
                  </span>
                ))}
              </dd>
            </div>
          );
        })}
      </dl>
      <div className="flex items-center gap-3 text-[12px] text-faint">
        <span>
          v{icp.version} · approved by {icp.approvedByName} {icp.approvedAt ? `on ${new Date(icp.approvedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""} · ✦ = inferred by AI
        </span>
        <span className="ml-auto">
          <ActionButton action={() => reviseIcp(icp.id)} variant="secondary">
            Revise
          </ActionButton>
        </span>
      </div>
    </div>
  );
}
