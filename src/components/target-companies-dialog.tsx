"use client";

import clsx from "clsx";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";
import { AiMark, buttonClass } from "@/components/ui";
import {
  HEADCOUNT_BANDS,
  REASON_CHIPS,
  REVENUE_BANDS,
  filterByReasons,
  normalizeCompanyName,
  type ClientProfile,
  type TargetCompany,
} from "@/lib/discovery/target-companies";
import { draftClientProfile, getTargetCompanies, regenerateTargetCompanies, saveTargetSelection, suggestCompaniesFrom, type TargetCompaniesView } from "@/server/discovery-actions";
import { StagedProgress } from "./staged-progress";
import { Spinner } from "./client";

type Row = TargetCompany & { key: string };

const manualRow = (name: string, rank: number): Row => ({
  key: normalizeCompanyName(name),
  name,
  website: "",
  industry: "",
  domain: "",
  product: "",
  headcount_band: "not known",
  revenue_band: "not known",
  match_reasons: [],
  reason: "",
  source_urls: [],
  rank,
  manual: true,
});

/**
 * Before an outbound search: the AI proposes up to 30 companies to source from, measured against
 * an editable profile of the client company. The recruiter picks; nothing is selected for them.
 * Native <dialog> (modal): focus stays inside, Esc closes.
 */
export function TargetCompaniesDialog({
  roleId,
  open,
  onClose,
  onSearch,
  onSaved,
  mode = "search",
}: {
  roleId: string;
  open: boolean;
  onClose: () => void;
  /** Search mode: called with the chosen company names ([] = search without target companies). */
  onSearch?: (companies: string[]) => void;
  /** Manage mode: called after the selection is saved on the role. */
  onSaved?: (selected: string[]) => void;
  /** "search" opens before a search; "manage" edits and saves the role's selection. */
  mode?: "search" | "manage";
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const [view, setView] = useState<TargetCompaniesView | null>(null);
  const [loading, setLoading] = useState(false);
  const [rows, setRows] = useState<Row[]>([]);
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [chips, setChips] = useState<string[]>([]);
  const [profile, setProfile] = useState<ClientProfile | null>(null);
  const [manual, setManual] = useState("");
  const [saving, setSaving] = useState(false);

  const apply = (v: TargetCompaniesView) => {
    setView(v);
    if (v.set) {
      const base = v.set.companies.map((c) => ({ ...c, key: normalizeCompanyName(c.name) }));
      const keys = new Set(base.map((r) => r.key));
      // Saved choices that aren't in the AI list (added by hand, or dropped by a regenerate) stay visible.
      const extra = v.set.selected.filter((n) => !keys.has(normalizeCompanyName(n))).map((n, i) => manualRow(n, base.length + i + 1));
      setRows([...base, ...extra]);
      setProfile(v.set.model === "none" ? null : v.set.clientProfile);
      // Only the recruiter's own saved choice is pre-ticked; nothing is selected for them.
      setPicked(new Set(v.set.selected.map(normalizeCompanyName)));
    }
  };

  // Generating runs in two real steps, each shown as it happens: profile the client, then find companies.
  const [step, setStep] = useState<0 | 1 | 2>(0);
  const generate = async (opts: { profile?: ClientProfile } = {}) => {
    setLoading(true);
    setView((v) => (v ? { ...v, error: undefined } : v));
    try {
      let profileForStep2 = opts.profile;
      if (!profileForStep2) {
        setStep(1);
        const p = await draftClientProfile(roleId);
        if ("error" in p) {
          setView((v) => ({ aiConfigured: true, client: v?.client ?? { name: null, website: null }, set: v?.set ?? null, error: p.error }));
          return;
        }
        profileForStep2 = p.profile;
      }
      setStep(2);
      apply(await (opts.profile ? regenerateTargetCompanies(roleId, opts.profile) : suggestCompaniesFrom(roleId, profileForStep2)));
    } catch {
      setView((v) => ({ aiConfigured: true, client: v?.client ?? { name: null, website: null }, set: v?.set ?? null, error: "Couldn't reach Talyn. Check your connection and try again." }));
    } finally {
      setLoading(false);
      setStep(0);
    }
  };

  const load = async (fn: () => Promise<TargetCompaniesView>) => {
    setLoading(true);
    try {
      apply(await fn());
    } catch {
      setView((v) => ({ aiConfigured: true, client: v?.client ?? { name: null, website: null }, set: v?.set ?? null, error: "Couldn't reach Talyn. Check your connection and try again." }));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const d = dialog.current;
    if (!d) return;
    if (open && !d.open) {
      d.showModal();
      if (!view)
        void (async () => {
          setLoading(true);
          try {
            const v = await getTargetCompanies(roleId, { generate: false });
            apply(v);
            setLoading(false);
            if (v.needsGeneration) await generate();
          } catch {
            setView({ aiConfigured: true, client: { name: null, website: null }, set: null, error: "Couldn't reach Talyn. Check your connection and try again." });
            setLoading(false);
          }
        })();
    } else if (!open && d.open) d.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const shown = useMemo(() => filterByReasons(rows, chips), [rows, chips]);
  const profileChanged = !!(profile && view?.set && JSON.stringify({ ...profile, edited: undefined, source_urls: undefined }) !== JSON.stringify({ ...view.set.clientProfile, edited: undefined, source_urls: undefined }));
  const toggle = (key: string) => setPicked((p) => (p.has(key) ? new Set([...p].filter((k) => k !== key)) : new Set([...p, key])));
  const chosenNames = rows.filter((r) => picked.has(r.key)).map((r) => r.name);

  const addManual = () => {
    const name = manual.trim().slice(0, 160);
    const key = normalizeCompanyName(name);
    if (!key) return;
    if (!rows.some((r) => r.key === key)) setRows((r) => [...r, manualRow(name, r.length + 1)]);
    setPicked((p) => new Set([...p, key]));
    setManual("");
  };

  const set = view?.set;
  return (
    <dialog
      ref={dialog}
      aria-labelledby={titleId}
      aria-busy={loading}
      className="my-auto w-[min(920px,96vw)] rounded-xl border border-line bg-surface p-0 text-ink backdrop:bg-ink/40"
      onClose={onClose}
    >
      <div className="flex max-h-[88vh] flex-col">
        <header className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div>
            <h2 id={titleId} className="text-[16px] font-semibold">
              Companies to source from
            </h2>
            <p className="text-[12.5px] text-muted">Pick the companies to look for people at. They raise matching profiles in the results; they don&apos;t hide anyone.</p>
          </div>
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-sunken hover:text-ink">
            Close <kbd className="ml-1">esc</kbd>
          </button>
        </header>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          {loading && step > 0 && (
            <div className="motion-fade rounded-lg border border-line bg-sunken/50 px-4 py-3">
              <StagedProgress
                stages={[
                  { key: "profile", label: `Profiling ${view?.client.name || "the client company"}`, detail: "Industry, product, headcount and revenue bands", state: step === 1 ? "active" : "done", slow: true },
                  { key: "companies", label: "Finding similar companies with web search", detail: "Up to 30, checked for duplicates and your exclusions. Usually 1–2 minutes.", state: step === 2 ? "active" : "pending", slow: true },
                ]}
              />
            </div>
          )}
          {loading && step === 0 && (
            <div role="status" className="flex items-center gap-2 rounded-lg bg-sunken px-3 py-3 text-[13px]">
              <Spinner /> Loading…
            </div>
          )}
          {view?.error && (
            <div role="alert" className="flex flex-wrap items-center gap-2 rounded-lg border border-danger/40 bg-danger-soft px-3 py-2 text-[13px] text-danger">
              {view.error}
              <button type="button" className={buttonClass("secondary", "sm")} onClick={() => generate()} disabled={loading}>
                Try again
              </button>
            </div>
          )}

          {set && (profile || rows.length > 0) && (
            <>
              {profile && (
                <>
              <p className="flex flex-wrap items-center gap-2 text-[12.5px] text-muted">
                <AiMark /> AI-generated; check before relying on headcount or revenue.
                <span className="text-faint">
                  {set.webSearch ? "Used web search." : "From the model only, without web search."} {set.generatedByName} · {new Date(set.generatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                </span>
              </p>

              <section aria-label="Client company profile" className="rounded-lg border border-line p-3">
                <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                  <h3 className="text-[13px] font-semibold">
                    {view?.client.name || "Client company"}
                    {profile.edited && <span className="ml-2 font-normal text-muted">(corrected by you)</span>}
                  </h3>
                  <span className="text-[12px] text-muted">Every match is measured against this. Correct anything that&apos;s wrong.</span>
                </div>
                <div className="grid gap-2 sm:grid-cols-3">
                  {(["industry", "domain", "product"] as const).map((k) => (
                    <label key={k} className={clsx("text-[12px] text-muted", k === "product" && "sm:col-span-3")}>
                      {k === "domain" ? "Domain / product category" : k[0].toUpperCase() + k.slice(1)}
                      <input
                        value={profile[k]}
                        onChange={(e) => setProfile({ ...profile, [k]: e.target.value })}
                        maxLength={k === "product" ? 240 : 120}
                        className="mt-0.5 block h-8 w-full rounded-md border border-line-strong bg-surface px-2 text-[13px] text-ink"
                      />
                    </label>
                  ))}
                  <label className="text-[12px] text-muted">
                    Headcount
                    <select value={profile.headcount_band} onChange={(e) => setProfile({ ...profile, headcount_band: e.target.value as ClientProfile["headcount_band"] })} className="mt-0.5 block h-8 w-full rounded-md border border-line-strong bg-surface px-1.5 text-[13px] text-ink">
                      {HEADCOUNT_BANDS.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                  <label className="text-[12px] text-muted">
                    Revenue
                    <select value={profile.revenue_band} onChange={(e) => setProfile({ ...profile, revenue_band: e.target.value as ClientProfile["revenue_band"] })} className="mt-0.5 block h-8 w-full rounded-md border border-line-strong bg-surface px-1.5 text-[13px] text-ink">
                      {REVENUE_BANDS.map((b) => <option key={b}>{b}</option>)}
                    </select>
                  </label>
                  <div className="flex items-end gap-2">
                    <button
                      type="button"
                      className={buttonClass(profileChanged ? "primary" : "secondary", "sm")}
                      disabled={loading}
                      onClick={() => generate(profileChanged ? { profile: { industry: profile.industry, domain: profile.domain, product: profile.product, headcount_band: profile.headcount_band, revenue_band: profile.revenue_band } } : {})}
                    >
                      {profileChanged ? "Update profile and regenerate" : "Regenerate"}
                    </button>
                  </div>
                </div>
                {!!profile.source_urls?.length && (
                  <p className="mt-1 text-[11.5px] text-faint">
                    Sources:{" "}
                    {profile.source_urls.map((u, i) => (
                      <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                        {i + 1}
                      </a>
                    )).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, " ", el] : [el]), [])}
                  </p>
                )}
              </section>
                </>
              )}
              {!profile && <p className="text-[12.5px] text-muted">Companies you added by hand. {view?.aiConfigured ? "Open again to get AI suggestions." : "AI suggestions need an AI provider; you can still add companies yourself."}</p>}

              <div role="group" aria-label="Show companies matched on" className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                <span className="mr-1 text-muted">Matched on:</span>
                <button type="button" aria-pressed={!chips.length} onClick={() => setChips([])} className={chipClass(!chips.length)}>
                  All
                </button>
                {REASON_CHIPS.map((c) => (
                  <button key={c.key} type="button" aria-pressed={chips.includes(c.key)} onClick={() => setChips((x) => (x.includes(c.key) ? x.filter((k) => k !== c.key) : [...x, c.key]))} className={chipClass(chips.includes(c.key))}>
                    {c.label}
                  </button>
                ))}
                <span className="ml-auto text-muted">
                  {shown.length} shown · {picked.size} selected
                </span>
                <button type="button" className="underline" onClick={() => setPicked(new Set([...picked, ...shown.map((r) => r.key)]))}>
                  Select all
                </button>
                <button type="button" className="underline" onClick={() => setPicked(new Set())}>
                  Clear
                </button>
              </div>

              <ul className="divide-y divide-line rounded-lg border border-line" aria-label="Suggested companies">
                {shown.length === 0 && <li className="px-3 py-3 text-[13px] text-muted">No companies matched on every selected reason. Choose fewer chips or All.</li>}
                {shown.map((c) => (
                  <li key={c.key} className="flex items-start gap-3 px-3 py-2.5 text-[13px]">
                    <input type="checkbox" checked={picked.has(c.key)} onChange={() => toggle(c.key)} aria-label={`Select ${c.name}`} className="mt-1 h-4 w-4" />
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-baseline gap-x-2">
                        <span className="font-medium">{c.manual ? c.name : `${c.rank}. ${c.name}`}</span>
                        {c.website && (
                          <a href={`https://${c.website}`} target="_blank" rel="noopener noreferrer nofollow" className="text-[12px] text-muted underline">
                            {c.website}
                          </a>
                        )}
                        {c.manual && <span className="text-[12px] text-muted">Added by you</span>}
                      </div>
                      {!c.manual && (
                        <>
                          <div className="text-[12px] text-ink-2">{[c.industry, c.domain, c.product, `${c.headcount_band} people`, `revenue ${c.revenue_band}`].filter(Boolean).join(" · ")}</div>
                          <div className="mt-0.5 flex flex-wrap gap-1">
                            {c.match_reasons.map((r) => (
                              <span key={r} className="rounded bg-sunken px-1.5 py-px text-[11.5px] text-ink-2">
                                {r}
                              </span>
                            ))}
                            {c.reason && <span className="text-[12px] text-muted">{c.reason}</span>}
                            {c.source_urls.length > 0 && (
                              <span className="text-[11.5px] text-faint">
                                · sources{" "}
                                {c.source_urls.map((u, i) => (
                                  <a key={u} href={u} target="_blank" rel="noopener noreferrer nofollow" className="underline">
                                    {i + 1}
                                  </a>
                                )).reduce<ReactNode[]>((acc, el, i) => (i ? [...acc, " ", el] : [el]), [])}
                              </span>
                            )}
                          </div>
                        </>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setRows((r) => r.filter((x) => x.key !== c.key));
                        setPicked((p) => new Set([...p].filter((k) => k !== c.key)));
                      }}
                      className="rounded px-1.5 text-[12px] text-muted hover:bg-sunken hover:text-ink"
                      aria-label={`Remove ${c.name}`}
                    >
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}

          {(set || view?.error || mode === "manage" || (view && !view.aiConfigured)) && (
            <div className="flex flex-wrap items-center gap-2 text-[13px]">
              <label htmlFor={`${titleId}-add`} className="text-muted">
                Add a company
              </label>
              <input
                id={`${titleId}-add`}
                value={manual}
                onChange={(e) => setManual(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addManual();
                  }
                }}
                maxLength={160}
                placeholder="Company name"
                className="h-8 w-56 rounded-md border border-line-strong bg-surface px-2"
              />
              <button type="button" className={buttonClass("secondary", "sm")} onClick={addManual} disabled={!manual.trim()}>
                Add
              </button>
            </div>
          )}
        </div>

        <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-5 py-3">
          <button type="button" className={buttonClass("ghost")} onClick={() => dialog.current?.close()}>
            Cancel
          </button>
          {mode === "manage" ? (
            <button
              type="button"
              className={buttonClass("primary")}
              disabled={saving || loading}
              onClick={async () => {
                setSaving(true);
                try {
                  const v = await saveTargetSelection(roleId, chosenNames);
                  if (v.error) setView(v);
                  else {
                    apply(v);
                    onSaved?.(v.set?.selected ?? []);
                    dialog.current?.close();
                  }
                } catch {
                  setView((v) => (v ? { ...v, error: "Couldn't save the selection. Check your connection and try again." } : v));
                } finally {
                  setSaving(false);
                }
              }}
            >
              {saving ? "Saving…" : `Save selection${chosenNames.length ? ` (${chosenNames.length})` : ""}`}
            </button>
          ) : (
            <>
              <button
                type="button"
                className={buttonClass("secondary")}
                onClick={() => {
                  dialog.current?.close();
                  onSearch?.([]);
                }}
              >
                Search without target companies
              </button>
              <button
                type="button"
                className={buttonClass("primary")}
                disabled={!chosenNames.length}
                onClick={() => {
                  dialog.current?.close();
                  onSearch?.(chosenNames);
                }}
              >
                Search these companies{chosenNames.length ? ` (${chosenNames.length})` : ""}
              </button>
            </>
          )}
        </footer>
      </div>
    </dialog>
  );
}

const chipClass = (on: boolean) => clsx("rounded-full border px-2.5 py-0.5 font-medium", on ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken");
