"use client";

import Papa from "papaparse";
import Link from "next/link";
import { useMemo, useState } from "react";
import { Spinner, usePendingTask } from "@/components/client";
import { Button, Card, Notice, Select, SectionTitle } from "@/components/ui";
import { IMPORT_FIELDS, guessMapping, type ImportFieldKey } from "@/lib/csv";
import { importCandidates, type ImportResult } from "@/server/import-actions";

const MAX_ROWS = 1000;
const MAX_BYTES = 5 * 1024 * 1024;

export function Importer({ roles, defaultRole }: { roles: { id: string; title: string }[]; defaultRole: string }) {
  const [fileName, setFileName] = useState<string | null>(null);
  const [headers, setHeaders] = useState<string[]>([]);
  const [rows, setRows] = useState<Record<string, string>[]>([]);
  const [mapping, setMapping] = useState<Record<string, ImportFieldKey | "">>({});
  const [roleId, setRoleId] = useState(defaultRole);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, start] = usePendingTask();

  const mapped = useMemo(() => new Set(Object.values(mapping).filter(Boolean)), [mapping]);
  const hasName = mapped.has("fullName") || mapped.has("firstName") || mapped.has("lastName");

  function onFile(file: File | undefined) {
    setError(null);
    setResult(null);
    if (!file) return;
    if (file.size > MAX_BYTES) return setError("CSV files must be 5 MB or smaller.");
    Papa.parse<Record<string, string>>(file, {
      header: true,
      skipEmptyLines: "greedy",
      complete: (res) => {
        const hs = (res.meta.fields ?? []).filter((h) => h.trim());
        if (hs.length === 0) return setError("No header row found. The first row must contain column names.");
        if (res.data.length > MAX_ROWS) return setError(`This file has ${res.data.length} rows. Import at most ${MAX_ROWS} at a time.`);
        setFileName(file.name);
        setHeaders(hs);
        setRows(res.data);
        setMapping(guessMapping(hs));
      },
      error: () => setError("The file couldn't be read as CSV."),
    });
  }

  function submit() {
    const payload = rows.map((r) => {
      const o: Partial<Record<ImportFieldKey, string>> = {};
      for (const h of headers) {
        const key = mapping[h];
        if (key && r[h]) o[key] = String(r[h]);
      }
      return o;
    });
    start(async () => {
      // Send in batches so each request stays well under the hosting body-size limit.
      const res: ImportResult = { created: 0, attached: 0, skipped: [] };
      for (let start = 0; start < payload.length; ) {
        let end = Math.min(start + 100, payload.length);
        while (end - start > 1 && JSON.stringify(payload.slice(start, end)).length > 3_000_000) end = start + Math.ceil((end - start) / 2);
        const part = await importCandidates(payload.slice(start, end), roleId || null, start);
        if (part.error) {
          res.error = res.created ? `${part.error} (${res.created} rows were imported before this.)` : part.error;
          break;
        }
        res.created += part.created;
        res.attached += part.attached;
        res.skipped.push(...part.skipped);
        start = end;
      }
      if (res.error) setError(res.error);
      if (res.created || !res.error) {
        setResult(res);
        setRows([]);
        setHeaders([]);
        setFileName(null);
      }
    });
  }

  return (
    <Card className="p-5">
      <SectionTitle hint="One candidate per row with a header row. Columns are matched automatically; adjust anything that's wrong.">Import candidates from CSV</SectionTitle>

      {result && (
        <Notice tone="ok" className="mb-4">
          Imported {result.created} candidate{result.created === 1 ? "" : "s"}
          {result.attached ? `, added ${result.attached} to the role pipeline` : ""}.
          {result.skipped.length > 0 && (
            <details className="mt-1 text-ink-2">
              <summary className="cursor-pointer">{result.skipped.length} row(s) skipped</summary>
              <ul className="mt-1 list-disc pl-5">
                {result.skipped.slice(0, 50).map((s) => (
                  <li key={s.row}>Row {s.row}: {s.reason}</li>
                ))}
              </ul>
            </details>
          )}
          <div className="mt-1">
            <Link href={roleId ? `/roles/${roleId}` : "/candidates"} className="font-medium underline">View candidates</Link>
          </div>
        </Notice>
      )}
      {error && <Notice tone="danger" className="mb-4">{error}</Notice>}

      <input
        type="file"
        accept=".csv,text/csv"
        onChange={(e) => onFile(e.target.files?.[0])}
        className="block w-full text-[13px] file:mr-3 file:h-9 file:rounded-lg file:border file:border-line-strong file:bg-surface file:px-3 file:text-sm file:font-medium hover:file:bg-sunken"
      />

      {headers.length > 0 && (
        <div className="mt-5 space-y-4">
          <div className="text-[13px] text-muted">
            <span className="font-medium text-ink">{fileName}</span> · {rows.length} rows
          </div>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[13px]">
              <thead className="bg-sunken text-left text-[12px] text-muted">
                <tr>
                  <th className="px-3 py-2 font-medium">CSV column</th>
                  <th className="px-3 py-2 font-medium">Imports as</th>
                  <th className="px-3 py-2 font-medium">First value</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {headers.map((h) => (
                  <tr key={h}>
                    <td className="px-3 py-1.5 font-medium">{h}</td>
                    <td className="px-3 py-1.5">
                      <Select
                        value={mapping[h] ?? ""}
                        onChange={(e) => setMapping((m) => ({ ...m, [h]: e.target.value as ImportFieldKey | "" }))}
                        className="h-8 w-52 text-[13px]"
                      >
                        <option value="">Don&apos;t import</option>
                        {IMPORT_FIELDS.map((f) => (
                          <option key={f.key} value={f.key} disabled={mapped.has(f.key) && mapping[h] !== f.key}>{f.label}</option>
                        ))}
                      </Select>
                    </td>
                    <td className="max-w-64 truncate px-3 py-1.5 text-muted">{rows.find((r) => r[h])?.[h] ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex items-center gap-2 text-[13px] text-muted">
              Add to role
              <Select value={roleId} onChange={(e) => setRoleId(e.target.value)} className="h-8 w-56 text-[13px]">
                <option value="">None</option>
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.title}</option>
                ))}
              </Select>
            </label>
            <span className="text-[12.5px] text-faint">Rows whose email already exists in your workspace are skipped.</span>
            <Button variant="primary" className="ml-auto" disabled={!hasName || pending} onClick={submit}>
              {pending && <Spinner />}Import {rows.length} rows
            </Button>
          </div>
          {!hasName && <p className="text-[13px] text-warn">Map a column to Full name (or First/Last name) to continue.</p>}
        </div>
      )}
    </Card>
  );
}
