import { RESULT_LABEL, type AssessmentResult } from "@/lib/domain";
import Link from "next/link";
import { MIN_MATERIAL_CHARS } from "@/lib/profile-score";
import { CREDIT, MIN_COVERAGE, pct, type ScoreResult } from "@/lib/score";
import { Badge } from "./ui";

/** Role fit (the same calculation as the profile score) with its scale, weights and calculation visible; coverage shown separately. */
export function ScorePanel({ score, adjusted, editHref }: { score: ScoreResult; adjusted: boolean; editHref?: string }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-x-8 gap-y-3">
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Role fit</div>
          {score.score === null ? (
            <div className="mt-0.5 text-[15px] font-semibold text-muted">Insufficient evidence</div>
          ) : (
            <div className="mt-0.5">
              <span className="text-3xl font-semibold tabular-nums tracking-tight">{score.score}</span>
              <span className="text-[13px] text-faint"> / 100</span>
              {score.status === "limited" && <Badge tone="warn" className="ml-2 align-middle">Limited evidence</Badge>}
            </div>
          )}
        </div>
        <div>
          <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Evidence coverage</div>
          <div className="mt-0.5 flex items-center gap-2">
            <span className="text-[15px] font-semibold tabular-nums">{pct(score.coverage)}</span>
            <span className="h-1.5 w-28 overflow-hidden rounded-full bg-sunken">
              <span className="block h-full bg-ink-2" style={{ width: pct(score.coverage) }} />
            </span>
          </div>
          <div className="text-[12px] text-muted">
            {score.essentialAssessable}/{score.essentialTotal} required items with evidence
          </div>
        </div>
      </div>
      <p className="text-[12.5px] text-ink-2">{score.reason}</p>
      <p className="text-[12px] text-faint">
        Measures how much of this role&apos;s approved skills and criteria the material shows. It is not a measure of candidate quality, potential or likelihood of
        hire, and it has not been validated as a predictor. It uses the same calculation as the profile score. {adjusted && "Includes your corrections."}
      </p>
      <details className="text-[12.5px]">
        <summary className="cursor-pointer font-medium text-muted hover:text-ink">How this is calculated</summary>
        <div className="mt-2 space-y-2">
          <p className="text-muted">
            Weights (set for this role): required = {score.weights.essential}, preferred = {score.weights.preferred}; informational criteria are not weighted.
            Credit: supported = {CREDIT.supported}; partially supported, inferred or conflicting = {CREDIT.partially_supported}; not shown in the material ={" "}
            {CREDIT.not_stated}; confirmed not present by a recruiter = {CREDIT.confirmed_absent}. Score = points ÷ total weight × 100. &ldquo;Not shown&rdquo; is
            missing evidence, not proof the candidate lacks it — ask, or correct it once you know. Insufficient evidence when there&apos;s under{" "}
            {MIN_MATERIAL_CHARS} characters of material to judge (no CV and only a title or a line or two). Flagged as limited below {pct(MIN_COVERAGE)} coverage;
            a required item with conflicting evidence keeps it out of the top band. Method: {score.method}.
            {editHref && (
              <>
                {" "}
                <Link href={editHref} className="font-medium text-brand underline-offset-2 hover:underline">
                  Edit criteria and weights
                </Link>
              </>
            )}
          </p>
          <div className="overflow-x-auto rounded-lg border border-line">
            <table className="w-full text-[12.5px]">
              <thead className="bg-sunken text-left text-muted">
                <tr>
                  <th className="px-2.5 py-1.5 font-medium">Criterion</th>
                  <th className="px-2.5 py-1.5 font-medium">Result</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Weight</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Credit</th>
                  <th className="px-2.5 py-1.5 text-right font-medium">Points</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {score.rows.map((r, i) => (
                  <tr key={i}>
                    <td className="px-2.5 py-1.5">{r.name}</td>
                    <td className="px-2.5 py-1.5">{RESULT_LABEL[r.result as AssessmentResult] ?? r.result}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{r.weight}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{r.credit === null ? "—" : r.credit}</td>
                    <td className="px-2.5 py-1.5 text-right tabular-nums">{r.points === null ? "—" : r.points}</td>
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
