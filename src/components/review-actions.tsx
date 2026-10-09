"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";
import { REJECT_REASONS } from "@/lib/domain";
import { clearDecision, setDecision } from "@/server/review-actions";
import { Spinner } from "./client";
import { useToast } from "./toast";

/**
 * Shortlist · Hold · Reject. Equal visual weight so none is suggested; the current decision is
 * pressed. Reject asks for a job-related reason first. The pipeline stage never changes here.
 */
export function ReviewActions({ applicationId, decision, name, compact = false, allowClear = false }: { applicationId: string; decision: string | null; name: string; compact?: boolean; allowClear?: boolean }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [rejecting, setRejecting] = useState(false);
  const [reason, setReason] = useState("");
  const [note, setNote] = useState("");
  const router = useRouter();
  const toast = useToast();
  const id = useId();

  const run = async (key: string, fn: () => Promise<{ error?: string } | undefined>, message: string) => {
    setBusy(key);
    setError(null);
    const r = await fn().catch(() => ({ error: "Something went wrong. Try again." }));
    setBusy(null);
    if (r?.error) return setError(r.error);
    setRejecting(false);
    toast({ message });
    router.refresh();
  };

  const btn = (key: "advance" | "hold" | "decline", label: string) => (
    <button
      type="button"
      aria-pressed={decision === key}
      disabled={!!busy}
      onClick={() =>
        key === "decline"
          ? setRejecting((v) => !v)
          : decision === key
            ? undefined
            : run(key, () => setDecision(applicationId, key), key === "advance" ? `${name} shortlisted — stage unchanged` : `${name} on hold — stage unchanged`)
      }
      className={clsx(
        "inline-flex h-7 items-center gap-1 rounded-md border px-2.5 text-[12.5px] font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-signal",
        decision === key ? "border-ink bg-ink text-white" : "border-line-strong bg-surface text-ink-2 hover:bg-sunken",
      )}
    >
      {busy === key && <Spinner />}
      {decision === key ? (key === "advance" ? "Shortlisted" : key === "hold" ? "On hold" : "Rejected") : label}
    </button>
  );

  return (
    <div className={clsx("flex flex-col items-start gap-1.5", compact && "items-end")}>
      <div className="flex flex-wrap gap-1" role="group" aria-label={`Decision for ${name}`}>
        {btn("advance", "Shortlist")}
        {btn("hold", "Hold")}
        {btn("decline", "Reject")}
        {allowClear && decision && (
          <button type="button" disabled={!!busy} onClick={() => run("clear", () => clearDecision(applicationId), decision === "advance" ? "Removed from shortlist" : "Decision cleared")} className="h-7 rounded-md px-2 text-[12px] text-muted hover:bg-sunken hover:text-ink">
            {busy === "clear" ? <Spinner /> : decision === "advance" ? "Remove from shortlist" : "Clear"}
          </button>
        )}
      </div>
      {rejecting && (
        <div className="w-full min-w-64 max-w-sm rounded-lg border border-line-strong bg-surface p-2.5 text-left shadow-sm">
          <label htmlFor={`${id}-r`} className="text-[12px] font-medium">
            Reason for rejecting {name}
          </label>
          <select id={`${id}-r`} value={reason} onChange={(e) => setReason(e.target.value)} className="mt-1 h-8 w-full rounded-md border border-line-strong bg-surface px-1.5 text-[12.5px]">
            <option value="">Choose a job-related reason…</option>
            {REJECT_REASONS.map((r) => (
              <option key={r.value} value={r.value}>
                {r.label}
              </option>
            ))}
          </select>
          <label htmlFor={`${id}-n`} className="mt-2 block text-[12px] font-medium">
            Note {reason === "other" ? "(required)" : "(optional)"}
          </label>
          <textarea id={`${id}-n`} value={note} onChange={(e) => setNote(e.target.value)} rows={2} maxLength={4000} className="mt-1 w-full rounded-md border border-line-strong px-2 py-1 text-[12.5px]" />
          <div className="mt-2 flex gap-1.5">
            <button
              type="button"
              disabled={!reason || !!busy}
              onClick={() => run("decline", () => setDecision(applicationId, "decline", { reason, note }), `${name} rejected — stage unchanged`)}
              className="inline-flex h-7 items-center gap-1 rounded-md bg-ink px-2.5 text-[12.5px] font-medium text-white disabled:opacity-50"
            >
              {busy === "decline" && <Spinner />}
              Confirm reject
            </button>
            <button type="button" onClick={() => setRejecting(false)} className="h-7 rounded-md px-2.5 text-[12.5px] text-muted hover:bg-sunken">
              Cancel
            </button>
          </div>
          <p className="mt-1.5 text-[11.5px] text-faint">Recorded as your decision. Talyn never rejects anyone automatically.</p>
        </div>
      )}
      {error && (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      )}
    </div>
  );
}
