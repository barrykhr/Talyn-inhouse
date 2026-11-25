"use client";

import clsx from "clsx";
import { useId, useMemo, useState } from "react";
import { Spinner } from "@/components/client";
import { AiMark, Input, Select, buttonClass } from "@/components/ui";
import { describeToFields, suggestSynonyms } from "@/server/discovery-actions";
import type { DescribedFields } from "@/lib/discovery/semantic";
import {
  PROV_LABEL,
  WORK_ARRANGEMENTS,
  WORK_ARRANGEMENT_LABEL,
  booleanKey,
  buildBoolean,
  checkBoolean,
  splitList,
  type BriefFields,
  type Prov,
  type Provenance,
} from "@/lib/discovery/brief";

const join = (xs: string[]) => xs.join(", ");

/** Where a value came from: From JD (with the quote) · Suggested · Not stated · Edited by you. */
export function ProvTag({ prov }: { prov?: Prov }) {
  if (!prov) return null;
  const tone = {
    from_jd: "bg-ok-soft text-ok",
    inferred: "bg-warn-soft text-warn",
    not_stated: "bg-gap-soft text-gap",
    edited: "bg-sunken text-ink-2",
    manual: "bg-sunken text-ink-2",
  }[prov.status];
  return (
    <span className={clsx("inline-flex items-center rounded px-1.5 py-px text-[11px] font-medium", tone)} title={prov.quote ? `“${prov.quote}”${prov.page ? ` — JD p.${prov.page}` : ""}` : undefined}>
      {prov.status === "from_jd" && prov.quote ? "From JD ✓" : PROV_LABEL[prov.status]}
    </span>
  );
}

function FieldRow({ id, label, prov, hint, children, quotes }: { id: string; label: string; prov?: Prov; hint?: string; children: React.ReactNode; quotes?: { value: string; quote: string | null }[] }) {
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <label htmlFor={id} className="text-[13px] font-medium text-ink">
          {label}
        </label>
        <ProvTag prov={prov} />
      </div>
      {children}
      {hint && <p className="text-[12px] text-muted">{hint}</p>}
      {prov?.status === "from_jd" && prov.quote && !quotes && <p className="quote truncate text-[11.5px] text-muted" title={prov.quote}>“{prov.quote}”{prov.page ? ` — p.${prov.page}` : ""}</p>}
      {quotes && quotes.length > 0 && (
        <details className="text-[11.5px] text-muted">
          <summary className="cursor-pointer">Where each came from in the JD</summary>
          <ul className="mt-1 space-y-0.5">
            {quotes.map((q) => (
              <li key={q.value}>
                <span className="font-medium text-ink-2">{q.value}</span> — {q.quote ? <span className="quote">“{q.quote}”</span> : <span className="text-warn">not found word-for-word in the JD</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

/**
 * The editable search fields and Boolean query. The query is regenerated live from the fields
 * until the recruiter edits it by hand; after that, a notice offers to regenerate when fields change.
 */
export function BriefFieldsEditor({
  initial,
  provenance = {},
  initialBoolean,
  initialBooleanEdited = false,
  initialBooleanKey = null,
  showProvenance = true,
  meaning,
}: {
  initial: BriefFields;
  provenance?: Provenance;
  initialBoolean?: string;
  initialBooleanEdited?: boolean;
  initialBooleanKey?: string | null;
  showProvenance?: boolean;
  /** Search by meaning on a role: describe the person, and other names for titles and skills. */
  meaning?: { roleId: string; aiConfigured: boolean; synonyms: Record<string, string[]>; describedAs: string | null };
}) {
  const id = useId();
  const [v, setV] = useState({
    roleName: initial.roleName,
    altTitles: join(initial.altTitles),
    skillsRequired: join(initial.skillsRequired),
    skillsPreferred: join(initial.skillsPreferred),
    exclusions: join(initial.exclusions),
    minYears: initial.minYears?.toString() ?? "",
    maxYears: initial.maxYears?.toString() ?? "",
    location: initial.location ?? "",
    workArrangement: initial.workArrangement ?? "",
  });
  const fields: BriefFields = useMemo(
    () => ({
      roleName: v.roleName.trim(),
      altTitles: splitList(v.altTitles),
      skillsRequired: splitList(v.skillsRequired),
      skillsPreferred: splitList(v.skillsPreferred),
      exclusions: splitList(v.exclusions),
      minYears: v.minYears === "" ? null : Number(v.minYears),
      maxYears: v.maxYears === "" ? null : Number(v.maxYears),
      location: v.location.trim() || null,
      workArrangement: (WORK_ARRANGEMENTS as readonly string[]).includes(v.workArrangement) ? (v.workArrangement as BriefFields["workArrangement"]) : null,
    }),
    [v],
  );
  const [edited, setEdited] = useState(initialBooleanEdited);
  const [manualQuery, setManualQuery] = useState(initialBoolean ?? buildBoolean(initial));
  const [keyAtGen, setKeyAtGen] = useState(initialBooleanKey ?? booleanKey(initial));
  const generated = buildBoolean(fields);
  const query = edited ? manualQuery : generated;
  const stale = edited && keyAtGen !== booleanKey(fields);
  const problem = query.trim() ? checkBoolean(query) : null;
  const [aiFilled, setAiFilled] = useState<Set<keyof BriefFields>>(new Set());
  const p = (k: keyof BriefFields): Prov | undefined => (aiFilled.has(k) ? ({ status: "inferred" } as Prov) : showProvenance ? provenance[k] : undefined);
  const applyDescribed = (d: DescribedFields) => {
    const next = { ...v };
    const filled = new Set<keyof BriefFields>();
    const put = (k: keyof typeof v & keyof BriefFields, val: string) => {
      if (val) {
        next[k] = val;
        filled.add(k);
      }
    };
    put("roleName", d.roleName);
    put("altTitles", join(d.altTitles));
    put("skillsRequired", join(d.skillsRequired));
    put("skillsPreferred", join(d.skillsPreferred));
    put("minYears", d.minYears?.toString() ?? "");
    put("maxYears", d.maxYears?.toString() ?? "");
    put("location", d.location ?? "");
    put("workArrangement", d.workArrangement ?? "");
    setV(next);
    setAiFilled(filled);
  };
  const items = (k: "skillsRequired" | "skillsPreferred") => {
    const it = provenance[k]?.items;
    return showProvenance && it ? fields[k].map((s) => ({ value: s, quote: it[s]?.quote ?? null })).filter((x) => it[x.value]) : undefined;
  };
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const yearsBad = fields.minYears != null && fields.maxYears != null && fields.minYears > fields.maxYears;

  return (
    <div className="space-y-4">
      {meaning && <DescribePanel roleId={meaning.roleId} aiConfigured={meaning.aiConfigured} initialText={meaning.describedAs} onUse={applyDescribed} />}
      <div className="grid gap-4 md:grid-cols-2">
        <FieldRow id={`${id}-rn`} label="Role name" prov={p("roleName")}>
          <Input id={`${id}-rn`} name="roleName" value={v.roleName} onChange={set("roleName")} required maxLength={200} placeholder="e.g. Senior Backend Engineer" />
        </FieldRow>
        <FieldRow id={`${id}-alt`} label="Alternative titles" prov={p("altTitles")} hint="Other titles for the same work. Comma-separated.">
          <Input id={`${id}-alt`} name="altTitles" value={v.altTitles} onChange={set("altTitles")} placeholder="e.g. Software Engineer, Platform Engineer" />
        </FieldRow>
        <FieldRow id={`${id}-req`} label="Required skills" prov={p("skillsRequired")} hint="Comma-separated. Each one is AND-ed in the Boolean query." quotes={items("skillsRequired")}>
          <Input id={`${id}-req`} name="skillsRequired" value={v.skillsRequired} onChange={set("skillsRequired")} placeholder="e.g. Go, PostgreSQL" />
        </FieldRow>
        <FieldRow id={`${id}-pref`} label="Preferred skills" prov={p("skillsPreferred")} hint="Shown as evidence on results; not added to the query." quotes={items("skillsPreferred")}>
          <Input id={`${id}-pref`} name="skillsPreferred" value={v.skillsPreferred} onChange={set("skillsPreferred")} placeholder="e.g. Kafka, AWS" />
        </FieldRow>
        <div className="grid grid-cols-2 gap-3">
          <FieldRow id={`${id}-min`} label="Min. years" prov={p("minYears")}>
            <Input id={`${id}-min`} name="minYears" type="number" min={0} max={50} value={v.minYears} onChange={set("minYears")} placeholder="Not stated" />
          </FieldRow>
          <FieldRow id={`${id}-max`} label="Max. years" prov={p("maxYears")}>
            <Input id={`${id}-max`} name="maxYears" type="number" min={0} max={50} value={v.maxYears} onChange={set("maxYears")} placeholder="Not stated" />
          </FieldRow>
          {yearsBad && <p className="col-span-2 text-[12px] text-danger">Minimum is more than maximum.</p>}
          <p className="col-span-2 text-[12px] text-muted">Shown as evidence on each result; never used to hide anyone.</p>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto] gap-3">
          <FieldRow id={`${id}-loc`} label="Location" prov={p("location")}>
            <Input id={`${id}-loc`} name="location" value={v.location} onChange={set("location")} placeholder="Not stated" />
          </FieldRow>
          <FieldRow id={`${id}-wa`} label="Work arrangement" prov={p("workArrangement")}>
            <Select id={`${id}-wa`} name="workArrangement" value={v.workArrangement} onChange={set("workArrangement")} className="w-36">
              <option value="">Not stated</option>
              {WORK_ARRANGEMENTS.map((w) => (
                <option key={w} value={w}>
                  {WORK_ARRANGEMENT_LABEL[w]}
                </option>
              ))}
            </Select>
          </FieldRow>
        </div>
      </div>
      {meaning && <AlsoMatch roleId={meaning.roleId} aiConfigured={meaning.aiConfigured} initial={meaning.synonyms} titles={[fields.roleName, ...fields.altTitles].filter(Boolean)} skills={[...fields.skillsRequired, ...fields.skillsPreferred]} />}
      <details className="text-[13px]" open={fields.exclusions.length > 0}>
        <summary className="cursor-pointer text-muted hover:text-ink">Exclusions</summary>
        <div className="mt-2">
          <FieldRow id={`${id}-ex`} label="Exclude profiles mentioning" prov={p("exclusions")} hint="Job-related only. Matching people are set aside where you can see them, never deleted.">
            <Input id={`${id}-ex`} name="exclusions" value={v.exclusions} onChange={set("exclusions")} />
          </FieldRow>
        </div>
      </details>

      <div className="space-y-1.5 rounded-lg border border-line bg-[#fbfaf8] p-3">
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor={`${id}-bool`} className="text-[13px] font-medium">
            Boolean search query
          </label>
          <span className="text-[11.5px] text-muted">{edited ? "Edited by you" : "Generated from the fields above — updates as you type"}</span>
          <button
            type="button"
            onClick={() => {
              setEdited(false);
              setManualQuery(generated);
              setKeyAtGen(booleanKey(fields));
            }}
            className="ml-auto h-7 rounded-md border border-line-strong bg-surface px-2.5 text-[12.5px] font-medium hover:bg-sunken"
          >
            Regenerate from fields
          </button>
        </div>
        <textarea
          id={`${id}-bool`}
          name="booleanQuery"
          value={query}
          onChange={(e) => {
            if (!edited) setKeyAtGen(booleanKey(fields));
            setEdited(true);
            setManualQuery(e.target.value);
          }}
          rows={3}
          spellCheck={false}
          className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 font-mono text-[12.5px] leading-relaxed focus:border-ink focus:outline-none"
          aria-describedby={`${id}-bool-help`}
        />
        <input type="hidden" name="booleanEdited" value={edited ? "1" : "0"} />
        <input type="hidden" name="booleanFieldsKey" value={keyAtGen} />
        <BooleanPreview query={query} />
        <p id={`${id}-bool-help`} className="text-[12px] text-muted">
          Titles are OR-ed; required skills and the location (unless remote) are AND-ed; exclusions use NOT. Sent as-is to providers that accept Boolean; each source&apos;s syntax may differ.
        </p>
        {stale && (
          <p role="status" className="text-[12px] text-warn">
            You changed the fields after editing this query. Regenerate to include the changes, or keep your version.
          </p>
        )}
        {problem && (
          <p role="alert" className="text-[12px] text-danger">
            {problem}
          </p>
        )}
      </div>
    </div>
  );
}

/** Read-only rendering with operators and quoted phrases highlighted. */
function BooleanPreview({ query }: { query: string }) {
  if (!query.trim()) return <p className="text-[12px] text-faint">Add a role name or skills to generate a query.</p>;
  const parts = query.split(/("[^"]*"|\bAND\b|\bOR\b|\bNOT\b|[()])/g).filter((x) => x !== "");
  return (
    <p aria-hidden className="break-words font-mono text-[12px] leading-relaxed text-ink-2">
      {parts.map((t, i) =>
        /^(AND|OR|NOT)$/.test(t) ? (
          <span key={i} className="font-semibold text-signal">
            {t}
          </span>
        ) : /^[()]$/.test(t) ? (
          <span key={i} className="text-faint">
            {t}
          </span>
        ) : t.startsWith('"') ? (
          <span key={i} className="text-inbound">
            {t}
          </span>
        ) : (
          <span key={i}>{t}</span>
        ),
      )}
    </p>
  );
}

/** "Describe the person": the AI fills the fields; the recruiter sees what it understood first. */
function DescribePanel({ roleId, aiConfigured, initialText, onUse }: { roleId: string; aiConfigured: boolean; initialText: string | null; onUse: (d: DescribedFields) => void }) {
  const id = useId();
  const [text, setText] = useState(initialText ?? "");
  const [used, setUsed] = useState(initialText ?? "");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<DescribedFields | null>(null);
  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await describeToFields(roleId, text);
      if (r.error) setError(r.error);
      else if (r.fields) setPreview(r.fields);
    } catch {
      setError("Couldn't reach Talyn. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  const row = (label: string, value: string) =>
    value ? (
      <div className="flex gap-2">
        <dt className="w-32 shrink-0 text-muted">{label}</dt>
        <dd className="min-w-0">{value}</dd>
      </div>
    ) : null;
  return (
    <div className="space-y-2 rounded-lg border border-line bg-sunken/40 p-3">
      <label htmlFor={`${id}-d`} className="text-[13px] font-medium">
        Describe the person
      </label>
      <p className="text-[12px] text-muted">In plain English or Hinglish, the way you would brief a recruiter. Talyn fills the fields below; you check them before searching.</p>
      <textarea
        id={`${id}-d`}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={2}
        maxLength={2000}
        placeholder="e.g. Senior backend engineer in Bengaluru, 5+ years, Go or Java, has scaled a payments system"
        className="w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[13px] focus:border-ink focus:outline-none"
      />
      <input type="hidden" name="describedAs" value={used} />
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={buttonClass("secondary", "sm")} onClick={run} disabled={busy || text.trim().length < 10 || !aiConfigured}>
          {busy ? (
            <>
              <Spinner /> Reading…
            </>
          ) : (
            "Fill the fields"
          )}
        </button>
        {!aiConfigured && <span className="text-[12px] text-muted">Needs an AI provider. You can fill the fields yourself.</span>}
        {error && (
          <span role="alert" className="text-[12px] text-danger">
            {error}
          </span>
        )}
      </div>
      {preview && (
        <div className="rounded-md border border-line bg-surface p-3 text-[13px]" role="status">
          <p className="mb-2 flex items-center gap-2 font-medium">
            <AiMark /> Talyn understood
          </p>
          <dl className="space-y-1">
            {row("Role", preview.roleName)}
            {row("Other titles", preview.altTitles.join(", "))}
            {row("Required skills", preview.skillsRequired.join(", "))}
            {row("Preferred skills", preview.skillsPreferred.join(", "))}
            {row("Experience", preview.minYears !== null || preview.maxYears !== null ? `${preview.minYears ?? "?"}–${preview.maxYears ?? "any"} years` : "")}
            {row("Location", [preview.location, preview.workArrangement].filter(Boolean).join(" · "))}
          </dl>
          {preview.otherNeeds.length > 0 && (
            <p className="mt-2 text-[12px] text-muted">
              Not searched as keywords: {preview.otherNeeds.map((n) => `“${n}”`).join(", ")}. Add them as criteria on the Criteria tab so assessments and AI ranking check for them.
            </p>
          )}
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className={buttonClass("primary", "sm")}
              onClick={() => {
                onUse(preview);
                setUsed(text.trim());
                setPreview(null);
              }}
            >
              Use these
            </button>
            <button type="button" className={buttonClass("ghost", "sm")} onClick={() => setPreview(null)}>
              Discard
            </button>
          </div>
          <p className="mt-1 text-[11.5px] text-faint">Filled fields are marked “Suggested” until you save. Nothing is searched yet.</p>
        </div>
      )}
    </div>
  );
}

/** Other names that count as evidence for a title or skill. Suggested by AI or typed; the recruiter removes any. */
function AlsoMatch({ roleId, aiConfigured, initial, titles, skills }: { roleId: string; aiConfigured: boolean; initial: Record<string, string[]>; titles: string[]; skills: string[] }) {
  const id = useId();
  const [syn, setSyn] = useState<Record<string, string[]>>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [term, setTerm] = useState("");
  const [alt, setAlt] = useState("");
  const terms = Array.from(new Set([...titles, ...skills]));
  const live = Object.fromEntries(terms.filter((t) => syn[t]?.length).map((t) => [t, syn[t]]));
  const add = (t: string, a: string) => {
    const x = a.trim().slice(0, 40);
    if (!t || !x || x.toLowerCase() === t.toLowerCase()) return;
    setSyn((s) => ({ ...s, [t]: Array.from(new Set([...(s[t] ?? []), x])).slice(0, 4) }));
  };
  const suggest = async () => {
    setBusy(true);
    setError(null);
    try {
      const r = await suggestSynonyms(roleId, { titles, skills });
      if (r.error) setError(r.error);
      else if (r.synonyms) {
        const found = r.synonyms;
        setSyn((s) => {
          const next = { ...s };
          for (const [t, alts] of Object.entries(found)) next[t] = Array.from(new Set([...(next[t] ?? []), ...alts])).slice(0, 4);
          return next;
        });
        if (!Object.keys(found).length) setError("No true alternative names found for these terms.");
      }
    } catch {
      setError("Couldn't reach Talyn. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="space-y-2 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[13px] font-medium">Also match</span>
        <span className="text-[12px] text-muted">Other names for the same title or skill. A match counts as evidence, and the card says which word matched.</span>
        <button type="button" className={clsx(buttonClass("secondary", "sm"), "ml-auto")} onClick={suggest} disabled={busy || !aiConfigured || !terms.length}>
          {busy ? (
            <>
              <Spinner /> Suggesting…
            </>
          ) : (
            "Suggest alternatives"
          )}
        </button>
      </div>
      <input type="hidden" name="synonyms" value={JSON.stringify(live)} />
      {Object.keys(live).length === 0 ? (
        <p className="text-[12px] text-faint">None yet.{aiConfigured ? " Suggest them, or add your own below." : " Add your own below."}</p>
      ) : (
        <ul className="space-y-1 text-[12.5px]">
          {Object.entries(live).map(([t, alts]) => (
            <li key={t} className="flex flex-wrap items-center gap-1.5">
              <span className="font-medium">{t}</span>
              <span className="text-faint">also matches</span>
              {alts.map((a) => (
                <span key={a} className="inline-flex items-center gap-1 rounded-md border border-line bg-sunken px-1.5 py-px">
                  {a}
                  <button type="button" aria-label={`Remove ${a} for ${t}`} className="text-muted hover:text-ink" onClick={() => setSyn((s) => ({ ...s, [t]: (s[t] ?? []).filter((x) => x !== a) }))}>
                    ×
                  </button>
                </span>
              ))}
            </li>
          ))}
        </ul>
      )}
      {error && (
        <p role="alert" className="text-[12px] text-danger">
          {error}
        </p>
      )}
      {terms.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 text-[12.5px]">
          <label htmlFor={`${id}-t`} className="text-muted">
            Add for
          </label>
          <select id={`${id}-t`} value={term} onChange={(e) => setTerm(e.target.value)} className="h-7 rounded-md border border-line-strong bg-surface px-1.5">
            <option value="">Choose a title or skill</option>
            {terms.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
          <input
            aria-label="Alternative name"
            value={alt}
            onChange={(e) => setAlt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                add(term, alt);
                setAlt("");
              }
            }}
            maxLength={40}
            placeholder="e.g. Golang"
            className="h-7 w-40 rounded-md border border-line-strong bg-surface px-2"
          />
          <button
            type="button"
            className={buttonClass("secondary", "sm")}
            disabled={!term || !alt.trim()}
            onClick={() => {
              add(term, alt);
              setAlt("");
            }}
          >
            Add
          </button>
        </div>
      )}
    </div>
  );
}
