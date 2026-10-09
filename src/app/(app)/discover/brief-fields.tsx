"use client";

import clsx from "clsx";
import { useId, useMemo, useState } from "react";
import { Input, Select } from "@/components/ui";
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
}: {
  initial: BriefFields;
  provenance?: Provenance;
  initialBoolean?: string;
  initialBooleanEdited?: boolean;
  initialBooleanKey?: string | null;
  showProvenance?: boolean;
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
  const p = (k: keyof BriefFields) => (showProvenance ? provenance[k] : undefined);
  const items = (k: "skillsRequired" | "skillsPreferred") => {
    const it = provenance[k]?.items;
    return showProvenance && it ? fields[k].map((s) => ({ value: s, quote: it[s]?.quote ?? null })).filter((x) => it[x.value]) : undefined;
  };
  const set = (k: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV({ ...v, [k]: e.target.value });
  const yearsBad = fields.minYears != null && fields.maxYears != null && fields.minYears > fields.maxYears;

  return (
    <div className="space-y-4">
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
