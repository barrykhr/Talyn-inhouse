import clsx from "clsx";
import { bandRanges, type Band, type ProfileRow } from "@/lib/profile-score";
import { RESULT_LABEL, type AssessmentResult } from "@/lib/domain";

export type ScoreSnapshot = {
  id: string;
  score: number | null;
  coverage: number;
  status: string; // ok | insufficient | alternative
  band: string | null;
  bandLabel: string | null;
  version: number;
  currentVersion: number;
  createdAt: Date;
  createdByName: string;
  trigger: string;
};

const BAND_CLS: Record<string, string> = {
  red: "bg-danger-soft text-danger border-danger/30",
  yellow: "bg-warn-soft text-warn border-warn/30",
  green: "bg-ok-soft text-ok border-ok/30",
};
const BAND_ICON: Record<string, string> = { red: "▼", yellow: "◆", green: "▲" };

/** Compact list chip: band label + score (advisory), or Insufficient evidence / Alternative route. Never colour alone. */
export function ProfileScoreChip({ s, className }: { s: ScoreSnapshot | null; className?: string }) {
  if (!s) return <span className={clsx("text-[12px] text-faint", className)}>No profile score</span>;
  const outdated = s.version !== s.currentVersion;
  if (s.status !== "ok" || s.score === null)
    return (
      <span className={clsx("inline-flex items-center gap-1 rounded-md border border-dashed border-line-strong px-1.5 py-0.5 text-[11.5px] font-medium text-muted", className)} title={s.status === "alternative" ? "Alternative assessment route — the screening score isn't used." : "Not enough known evidence for a meaningful score."}>
        {s.status === "alternative" ? "Alternative route" : "Insufficient evidence"}
        {outdated && <span className="text-faint">· v{s.version}</span>}
      </span>
    );
  return (
    <span
      className={clsx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] font-semibold", BAND_CLS[s.band ?? ""] ?? "bg-sunken text-ink-2", className)}
      title={`Advisory only — profile score ${s.score}/100 (scoring v${s.version}${outdated ? `, current is v${s.currentVersion}` : ""}); evidence coverage ${Math.round(s.coverage * 100)}%. A person decides.`}
    >
      <span aria-hidden>{BAND_ICON[s.band ?? ""]}</span>
      <span className="tabular-nums">{s.score}</span>
      <span className="font-medium">· {s.bandLabel}</span>
      {outdated && <span className="font-normal opacity-70">· v{s.version}</span>}
    </span>
  );
}

/** Full explanation: score and band, coverage shown separately, rows with weights and evidence, and the calculation. */
export function ProfileScoreDetail({
  s,
  rows,
  reason,
  bands,
  weights,
  minCoverage,
  requiredKnown,
  requiredTotal,
}: {
  s: ScoreSnapshot;
  rows: ProfileRow[];
  reason: string;
  bands: Band[];
  weights: { required: number; preferred: number };
  minCoverage: number;
  requiredKnown: number;
  requiredTotal: number;
}) {
  const pct = (n: number) => `${Math.round(n * 100)}%`;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Profile score</div>
          {s.status === "ok" && s.score !== null ? (
            <div className="mt-0.5 flex items-baseline gap-2">
              <span className="text-3xl font-semibold tabular-nums tracking-tight">{s.score}</span>
              <span className="text-[13px] text-faint">/ 100</span>
            </div>
          ) : (
            <div className="mt-0.5 text-[15px] font-semibold text-muted">{s.status === "alternative" ? "Not used — alternative route" : "Insufficient evidence"}</div>
          )}
          <div className="mt-1">
            <ProfileScoreChip s={s} />
          </div>
        </div>
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Evidence coverage</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[15px] font-semibold tabular-nums">{pct(s.coverage)}</span>
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-sunken">
              <span className="block h-full bg-ink-2" style={{ width: pct(s.coverage) }} />
            </span>
          </div>
          <div className="text-[12px] text-muted">
            {requiredKnown}/{requiredTotal} Required items with known evidence · minimum {pct(minCoverage)}
          </div>
        </div>
      </div>
      <p className="text-[12.5px] text-ink-2">{reason}</p>
      <p className="text-[12px] text-faint">
        Advisory only. The label is not a decision: nobody is rejected, advanced or hidden by it. Scoring v{s.version}
        {s.version !== s.currentVersion ? ` (current is v${s.currentVersion} — recalculate on the role's Criteria tab)` : ""} · recorded {s.createdAt.toLocaleDateString()} by {s.createdByName} ({s.trigger}). It is
        not a validated predictor and isn&apos;t claimed to be unbiased.
      </p>
      <details className="text-[12.5px]">
        <summary className="cursor-pointer font-medium text-muted hover:text-ink">How this score was calculated</summary>
        <div className="mt-2 space-y-2">
          <p className="text-muted">
            Weights: Required = {weights.required}, Preferred = {weights.preferred}; informational items aren&apos;t scored. Credit: supported = 1, partially supported = 0.5,
            confirmed not present (by a recruiter) = 0. Not stated, inferred and conflicting are unknown: left out of the score and they lower coverage. Score = points ÷ weight with
            known evidence × 100. Bands: {bandRanges(bands).map((b) => `${b.label} ${b.min}–${b.maxInclusive ? "100" : `<${b.max}`}`).join(" · ")}.
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[12.5px]">
              <thead className="bg-sunken text-left text-muted">
                <tr>
                  <th className="px-2.5 py-1.5 font-medium">Skill / criterion</th>
                  <th className="px-2.5 py-1.5 font-medium">Result</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Weight</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Credit</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Points</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Excerpts</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2.5 py-1.5">
                      {r.name} <span className="text-faint">{r.kind === "skill" ? "skill" : "criterion"} · {r.importance === "preferred" ? "Preferred" : "Required"}</span>
                    </td>
                    <td className="px-2.5 py-1.5">
                      {RESULT_LABEL[r.result as AssessmentResult] ?? r.result}
                      {r.corrected && <span className="text-warn"> · corrected</span>}
                    </td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{r.weight}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{r.credit === null ? "unknown" : r.credit}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{r.points === null ? "—" : r.points}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{r.evidence}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </details>
    </div>
  );
}
