"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { REJECT_REASONS } from "@/lib/domain";
import { setDecision } from "@/server/review-actions";

/**
 * Review mode controls: S, H, R decide; ← → move; Esc leaves. Reject asks for a reason first.
 * After a decision the next candidate slides in. Keys are ignored while typing in a field.
 */
export function ReviewControls({
  applicationId,
  roleId,
  index,
  total,
  scope,
  current,
}: {
  applicationId: string;
  roleId: string;
  index: number;
  total: number;
  scope: "undecided" | "all";
  current: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const [error, setError] = useState<string | null>(null);
  const reasonRef = useRef<HTMLSelectElement>(null);
  const base = `/roles/${roleId}/decide?scope=${scope}`;

  const go = useCallback(
    (i: number, dir: "next" | "prev") => {
      if (i < 0 || i >= total) return;
      router.push(`${base}&i=${i}&d=${dir}`, { scroll: false });
    },
    [base, total, router],
  );

  const decide = useCallback(
    async (decision: "advance" | "hold" | "decline") => {
      if (busy) return;
      if (decision === "decline" && !rejecting) {
        setRejecting(true);
        setTimeout(() => reasonRef.current?.focus(), 30);
        return;
      }
      setBusy(true);
      setError(null);
      const r = await setDecision(applicationId, decision, decision === "decline" ? { reason, note } : {}).catch(() => ({ error: "Couldn't record it. Try again." }));
      setBusy(false);
      if (r && "error" in r && r.error) return setError(r.error);
      setRejecting(false);
      // Undecided scope: the decided person leaves the list, so the same index is the next one.
      if (scope === "undecided") router.push(`${base}&i=${Math.min(index, Math.max(0, total - 2))}&d=next`, { scroll: false });
      else if (index + 1 < total) go(index + 1, "next");
      else router.refresh();
    },
    [busy, rejecting, applicationId, reason, note, scope, base, index, total, go, router],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (e.key === "Escape" && rejecting) {
        setRejecting(false);
        e.preventDefault();
        return;
      }
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "arrowright" || k === "j") go(index + 1, "next");
      else if (k === "arrowleft" || k === "k") go(index - 1, "prev");
      else if (k === "s") void decide("advance");
      else if (k === "h") void decide("hold");
      else if (k === "r") void decide("decline");
      else if (k === "escape") rejecting ? setRejecting(false) : router.push(`/roles/${roleId}?tab=applicants`);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [go, decide, index, rejecting, roleId, router]);

  const btn = (d: "advance" | "hold" | "decline", label: string, key: string) => (
    <button
      type="button"
      onClick={() => decide(d)}
      disabled={busy}
      aria-pressed={current === d}
      className={clsx(
        "flex items-center gap-2 rounded-lg border px-3.5 py-2 text-[13.5px] font-semibold transition-[transform,background-color,border-color] active:scale-[0.97] disabled:opacity-50",
        current === d ? "border-ink bg-ink text-white" : "border-line-strong bg-surface hover:border-ink",
        d === "decline" && rejecting && "border-danger text-danger",
      )}
    >
      {label} <kbd className="rounded border border-current/30 px-1 text-[11px] font-medium opacity-70">{key}</kbd>
    </button>
  );

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {btn("advance", "Shortlist", "S")}
        {btn("hold", "Hold", "H")}
        {btn("decline", "Reject", "R")}
        <span className="ml-auto flex items-center gap-1.5">
          <button type="button" onClick={() => go(index - 1, "prev")} disabled={index === 0} className="rounded-lg border border-line-strong px-2.5 py-2 text-[13px] disabled:opacity-40" aria-label="Previous candidate">
            ←
          </button>
          <button type="button" onClick={() => go(index + 1, "next")} disabled={index + 1 >= total} className="rounded-lg border border-line-strong px-2.5 py-2 text-[13px] disabled:opacity-40" aria-label="Next candidate">
            →
          </button>
        </span>
      </div>
      {rejecting && (
        <div className="motion-fade flex flex-wrap items-center gap-2 rounded-lg border border-danger/30 bg-danger-soft px-3 py-2">
          <label htmlFor="rm-reason" className="text-[13px] font-medium text-danger">
            Reason (required)
          </label>
          <select id="rm-reason" ref={reasonRef} value={reason} onChange={(e) => setReason(e.target.value)} className="h-8 rounded-md border border-line-strong bg-surface px-2 text-[13px]">
            <option value="">Choose a job-related reason</option>
            {REJECT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "other" ? "Note (required)" : "Note (optional)"} aria-label="Note" maxLength={4000} className="h-8 min-w-[200px] flex-1 rounded-md border border-line-strong bg-surface px-2 text-[13px]" />
          <button type="button" onClick={() => decide("decline")} disabled={!reason || busy} className="rounded-md bg-danger px-3 py-1.5 text-[13px] font-semibold text-white disabled:opacity-50">
            Reject
          </button>
          <button type="button" onClick={() => setRejecting(false)} className="text-[13px] text-muted underline">
            Cancel
          </button>
        </div>
      )}
      {error && (
        <p role="alert" className="text-[13px] text-danger">
          {error}
        </p>
      )}
      <p className="text-[12px] text-faint">Keys: S Shortlist · H Hold · R Reject · ← → move · Esc back. Decisions are yours; the stage doesn&apos;t move.</p>
    </div>
  );
}
