import clsx from "clsx";
import { SKILL_STATUS_HELP, SKILL_STATUS_LABEL, THRESHOLD_LABEL, THRESHOLD_SHORT, countLabel, type SkillMatch, type SkillStatus, type ThresholdState } from "@/lib/skills";

// Every status pairs an icon and a text label, so meaning never depends on colour alone.

const STATUS_CLS: Record<SkillStatus, string> = {
  evidence_found: "bg-ok-soft text-ok",
  partial: "bg-warn-soft text-warn",
  no_evidence: "bg-sunken text-ink-2",
  needs_review: "border border-dashed border-signal/60 text-signal",
  confirmed_absent: "bg-gap-soft text-gap",
};

export function SkillStatusBadge({ status, struck, className }: { status: SkillStatus; struck?: boolean; className?: string }) {
  return (
    <span
      title={SKILL_STATUS_HELP[status]}
      className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium leading-4", STATUS_CLS[status], struck && "line-through opacity-60", className)}
    >
      <StatusIcon status={status} />
      {SKILL_STATUS_LABEL[status]}
    </span>
  );
}

function StatusIcon({ status }: { status: SkillStatus }) {
  const common = { width: 10, height: 10, viewBox: "0 0 10 10", "aria-hidden": true } as const;
  if (status === "evidence_found")
    return (
      <svg {...common}>
        <path d="M2 5.2l2 2L8 3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
      </svg>
    );
  if (status === "partial")
    return (
      <svg {...common}>
        <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.4" fill="none" />
        <path d="M5 1.5a3.5 3.5 0 010 7z" fill="currentColor" />
      </svg>
    );
  if (status === "needs_review")
    return (
      <svg {...common}>
        <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeDasharray="2 1.5" />
      </svg>
    );
  if (status === "confirmed_absent")
    return (
      <svg {...common}>
        <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    );
  return (
    <svg {...common}>
      <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.2" fill="none" />
    </svg>
  );
}

const THRESHOLD_CLS: Record<ThresholdState, string> = {
  meets: "bg-ok-soft text-ok",
  below: "bg-sunken text-ink-2",
  needs_review: "border border-dashed border-signal/60 text-signal",
  not_assessed: "text-muted",
  no_threshold: "text-muted",
  no_skills: "text-faint",
};

export function ThresholdChip({ state, className, short = true }: { state: ThresholdState; className?: string; short?: boolean }) {
  const icon =
    state === "meets" ? (
      <path d="M2 5.2l2 2L8 3" stroke="currentColor" strokeWidth="1.6" fill="none" strokeLinecap="round" />
    ) : state === "below" ? (
      <path d="M5 2v5.5M2.8 5.5 5 7.8l2.2-2.3" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" />
    ) : state === "needs_review" ? (
      <circle cx="5" cy="5" r="3.5" stroke="currentColor" strokeWidth="1.4" fill="none" strokeDasharray="2 1.5" />
    ) : (
      <path d="M2.5 5h5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    );
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11.5px] font-semibold leading-4", THRESHOLD_CLS[state], className)} title={THRESHOLD_LABEL[state]}>
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        {icon}
      </svg>
      {short ? THRESHOLD_SHORT[state] : THRESHOLD_LABEL[state]}
    </span>
  );
}

/**
 * Compact list cell: "5/6 required" plus the threshold state. The accessible name spells it out.
 * Never an evaluation score; never a decision.
 */
export function SkillCount({ m, className, stacked = false }: { m: SkillMatch; className?: string; stacked?: boolean }) {
  if (m.state === "no_skills") return <span className={clsx("text-[12px] text-faint", className)}>No required skills set</span>;
  const a11y =
    m.evidenced === null
      ? `Required skills: no count. ${THRESHOLD_LABEL[m.state]}. ${m.reason}`
      : `${m.evidenced} of ${m.required} required skills evidenced${m.threshold != null ? `, threshold ${m.threshold}` : ""}. ${THRESHOLD_LABEL[m.state]}.${m.stale ? " Assessment out of date." : ""}`;
  return (
    <span className={clsx("inline-flex flex-wrap items-center gap-x-2 gap-y-1", stacked && "flex-col items-start", className)} title={m.reason}>
      <span className="sr-only">{a11y}</span>
      <span aria-hidden className="inline-flex items-baseline gap-1">
        <span className="font-mono text-[15px] font-semibold tabular-nums tracking-tight text-ink">{countLabel(m)}</span>
        <span className="text-[11.5px] text-muted">required{m.stale ? " · out of date" : ""}</span>
      </span>
      <span aria-hidden>
        <ThresholdChip state={m.state} />
      </span>
    </span>
  );
}

/** Two filter selects for list forms: threshold status and minimum required-skill count. */
export function SkillFilterFields({ skills, minskills, required, compact = false }: { skills: string; minskills: string; required: number; compact?: boolean }) {
  const cls = compact ? "h-8 rounded-md border border-line-strong bg-surface px-1.5 text-[13px] text-ink" : "h-9 rounded-lg border border-line-strong bg-surface px-2";
  return (
    <>
      <label className={compact ? "flex items-center gap-1.5 text-muted" : "flex flex-col gap-1"}>
        <span className={compact ? "" : "font-medium text-ink-2"}>Skill threshold</span>
        <select name="skills" defaultValue={skills} className={cls}>
          <option value="">Any</option>
          <option value="meets">{THRESHOLD_LABEL.meets}</option>
          <option value="below">{THRESHOLD_LABEL.below}</option>
          <option value="needs_review">{THRESHOLD_LABEL.needs_review}</option>
          <option value="not_assessed">{THRESHOLD_LABEL.not_assessed}</option>
        </select>
      </label>
      {required > 0 && (
        <label className={compact ? "flex items-center gap-1.5 text-muted" : "flex flex-col gap-1"}>
          <span className={compact ? "" : "font-medium text-ink-2"}>Required skills</span>
          <select name="minskills" defaultValue={minskills} className={cls}>
            <option value="">Any count</option>
            {Array.from({ length: required }, (_, i) => required - i).map((n) => (
              <option key={n} value={n}>
                {n === required ? `All ${required}` : `At least ${n} of ${required}`}
              </option>
            ))}
          </select>
        </label>
      )}
    </>
  );
}
