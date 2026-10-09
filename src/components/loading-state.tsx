"use client";

import { useEffect, useState } from "react";

/**
 * Honest loading: says what is loading, and if the server hasn't answered after a while says so
 * and offers Retry — never an endless spinner. Skeleton rows keep the layout stable.
 */
export function LoadingState({ label, rows = 3 }: { label: string; rows?: number }) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const t = setInterval(() => setSecs((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);
  return (
    <div aria-busy={secs < 25} className="space-y-4">
      <div role="status" aria-live="polite" className="flex flex-wrap items-center gap-2 text-[13px] text-muted">
        {secs < 25 ? (
          <>
            <span className="activity-dot inline-block h-1.5 w-1.5 rounded-full bg-brand" aria-hidden />
            Loading {label}…{secs >= 8 && <span> still waiting for the server ({secs}s)</span>}
          </>
        ) : (
          <span className="rounded-lg border border-[#f0dcae] bg-warn-soft px-3 py-2 text-warn">
            {label.charAt(0).toUpperCase() + label.slice(1)} didn&apos;t load — the server hasn&apos;t responded in {secs} seconds. Nothing was changed.{" "}
            <button type="button" onClick={() => window.location.reload()} className="font-semibold underline">
              Retry
            </button>{" "}
            or{" "}
            <a href="/home" className="font-semibold underline">
              go to Home
            </a>
            .
          </span>
        )}
      </div>
      <div className="space-y-2" aria-hidden>
        <div className="h-7 w-64 rounded-lg bg-sunken" />
        {Array.from({ length: rows }).map((_, i) => (
          <div key={i} className="h-14 rounded-[var(--radius-card)] bg-sunken/70" />
        ))}
      </div>
    </div>
  );
}
