"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";

export type StageState = "pending" | "active" | "done" | "failed" | "skipped";
export type Stage = { key: string; label: string; detail?: string | null; state: StageState; slow?: boolean };

/**
 * Truthful, staged progress. Each stage maps to real work and only completes when that work
 * returns. Active stages show an indeterminate bar (never invented percentages); slow AI stages
 * show elapsed time so waiting is understandable. Announced politely to assistive tech.
 */
export function StagedProgress({ stages }: { stages: Stage[] }) {
  const active = stages.find((s) => s.state === "active");
  return (
    <div>
      <p className="sr-only" aria-live="polite">
        {active ? `${active.label}…` : stages.every((s) => s.state === "done" || s.state === "skipped") ? "Ready for review" : ""}
      </p>
      <ol className="space-y-0.5">
        {stages.map((s, i) => (
          <li key={s.key} className="relative">
            {i < stages.length - 1 && (
              <span aria-hidden className={clsx("absolute left-[11px] top-7 h-[calc(100%-18px)] w-px", s.state === "done" ? "bg-ok/40" : "bg-line")} />
            )}
            <div className="flex items-start gap-3 py-1.5">
              <StageIcon state={s.state} />
              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-3">
                  <span
                    className={clsx(
                      "text-[14px]",
                      s.state === "active" && "font-medium text-ink",
                      s.state === "done" && "text-ink-2",
                      s.state === "pending" && "text-faint",
                      s.state === "skipped" && "text-faint line-through decoration-faint/40",
                      s.state === "failed" && "font-medium text-danger",
                    )}
                  >
                    {s.label}
                  </span>
                  {s.state === "active" && s.slow && <Elapsed />}
                </div>
                {s.detail && <p className={clsx("mt-0.5 text-[12.5px]", s.state === "failed" ? "text-danger" : "text-muted")}>{s.detail}</p>}
                {s.state === "active" && <div className="indeterminate-bar mt-2 h-[3px] rounded-full bg-sunken" aria-hidden />}
              </div>
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

function StageIcon({ state }: { state: StageState }) {
  const base = "mt-0.5 flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-full";
  if (state === "done")
    return (
      <span className={clsx(base, "motion-fade bg-ok text-white")}>
        <svg width="11" height="11" viewBox="0 0 12 12" aria-hidden>
          <path d="M2.5 6.3l2.3 2.2L9.5 3.8" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </span>
    );
  if (state === "failed")
    return (
      <span className={clsx(base, "bg-danger text-white")}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" />
        </svg>
      </span>
    );
  if (state === "active")
    return (
      <span className={clsx(base, "border-2 border-signal")}>
        <span className="activity-dot h-2 w-2 rounded-full bg-signal" />
      </span>
    );
  return <span className={clsx(base, "border border-line-strong bg-surface")} />;
}

function Elapsed() {
  const [start] = useState(() => Date.now());
  const [now, setNow] = useState(start);
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  const s = Math.floor((now - start) / 1000);
  if (s < 3) return null;
  return <span className="shrink-0 text-[12px] tabular-nums text-faint">{s < 60 ? `${s}s` : `${Math.floor(s / 60)}m ${s % 60}s`}</span>;
}
