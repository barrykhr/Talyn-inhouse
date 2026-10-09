"use client";

import { useState } from "react";
import { Spinner } from "@/components/client";
import { Button, Card } from "@/components/ui";
import { estimatePool, type PoolEstimate } from "@/server/pool-actions";

/** On-demand estimate of the internal candidate pool for the saved must-have skills. */
export function PoolEstimatePanel({ roleId, hasRequired }: { roleId: string; hasRequired: boolean }) {
  const [pending, setPending] = useState(false);
  const [data, setData] = useState<PoolEstimate | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async () => {
    setPending(true);
    setError(null);
    const r = await estimatePool(roleId).catch(() => ({ ok: false as const, error: "The estimate couldn't be computed. Try again." }));
    setPending(false);
    if (r.ok) setData(r);
    else setError(r.error);
  };
  return (
    <Card className="p-4 text-[13px]">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <div className="font-medium">Pool estimate (before searching)</div>
          <p className="text-[12.5px] text-muted">How many people already in Talyn show the saved must-have skills, and which skills narrow the pool most.</p>
        </div>
        <Button size="sm" variant="secondary" onClick={run} disabled={pending || !hasRequired} title={hasRequired ? undefined : "Save the search setup with required skills first"}>
          {pending && <Spinner />}
          {data ? "Recalculate" : "Estimate pool"}
        </Button>
      </div>
      {error && <p className="mt-2 text-danger">{error}</p>}
      {data && (
        <div className="motion-enter mt-3 space-y-3">
          <p>
            <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-muted">Estimate</span>{" "}
            <strong className="tabular-nums">{data.matchAll}</strong> of {data.population} candidates in Talyn mention all {data.mustHave.length} must-have skill{data.mustHave.length === 1 ? "" : "s"}
            {data.location && data.matchAllInLocation !== null && (
              <>
                {" "}
                · <strong className="tabular-nums">{data.matchAllInLocation}</strong> of those list a location matching “{data.location.value}”
              </>
            )}
            .
          </p>
          {data.population < 5 && <p className="text-warn">Insufficient data: fewer than 5 candidates with text to check, so these numbers say little.</p>}
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[12.5px]">
              <thead className="bg-sunken text-left text-muted">
                <tr>
                  <th className="px-2.5 py-1.5 font-medium">Must-have skill</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Mention it</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Pool if moved to Preferred</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Narrows the pool by</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {[...data.perSkill]
                  .sort((a, b) => b.ifPreferred - data.matchAll - (a.ifPreferred - data.matchAll))
                  .map((s) => (
                    <tr key={s.skill}>
                      <td className="px-2.5 py-1.5">{s.skill}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{s.have}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{s.ifPreferred}</td>
                      <td className="px-2.5 py-1.5 text-right tabular-nums">{s.ifPreferred - data.matchAll}</td>
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
          <ul className="space-y-0.5 text-[12px] text-muted">
            {data.sources.map((s) => (
              <li key={s.label}>
                {s.included ? "✓ Included" : "○ Not included"} — <span className="text-ink-2">{s.label}</span>: {s.why}
              </li>
            ))}
            <li>
              Computed {new Date(data.computedAt).toLocaleString()} from {data.population} candidates with text
              {data.withoutText ? ` (${data.withoutText} more have no CV or profile text and can't be checked)` : ""}
              {data.oldestCv && data.newestCv ? ` · CVs added ${new Date(data.oldestCv).toLocaleDateString()}–${new Date(data.newestCv).toLocaleDateString()}` : ""}
              {data.capped ? " · limited to the 3,000 most recently updated candidates" : ""}.
            </li>
            {data.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
}
