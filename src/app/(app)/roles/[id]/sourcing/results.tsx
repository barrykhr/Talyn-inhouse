"use client";

import clsx from "clsx";
import Link from "next/link";
import { useState } from "react";
import { ActionButton } from "@/components/client";
import { reviewProfile, saveProfileToRole } from "@/server/sourcing-actions";

export type ProfileView = {
  id: string;
  source: string;
  sourceLabel: string;
  sourceUrl: string | null;
  retrievedAt: string;
  displayName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  fields: Record<string, { value: string; source: string; asOf: string }>;
  signals: { category: string; term: string; matched: boolean; quote: string | null; page: number | null }[];
  matchedSignals: number;
  totalSignals: number;
  evidenceStatus: string;
  staleReason: string | null;
  duplicateReason: string | null;
  status: string;
  excludedBy: string | null;
  feedback: string | null;
  savedApplicationId: string | null;
};

const CAT: Record<string, string> = { title: "Title", skill_required: "Required", skill_preferred: "Preferred", location: "Location" };
const REASONS = ["Wrong title or function", "Missing required skills", "Wrong location", "Seniority mismatch", "Already contacted", "Other"];
const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

export function ResultRow({ p }: { p: ProfileView }) {
  const [reasonOpen, setReasonOpen] = useState(false);
  const field = (k: string) => p.fields[k];
  return (
    <div className={clsx("px-4 py-4", p.status === "dismissed" && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            {p.source === "talyn" && p.sourceUrl ? (
              <Link href={p.sourceUrl} className="font-medium hover:underline">
                {p.displayName}
              </Link>
            ) : (
              <span className="font-medium">{p.displayName}</span>
            )}
            <span className="text-[12px] text-muted">
              {p.matchedSignals} of {p.totalSignals} signals matched
            </span>
          </div>
          <div className="text-[12.5px] text-ink-2">
            {[p.currentTitle, p.currentCompany, p.location].filter(Boolean).join(" · ") || <span className="text-faint">No title or location on record</span>}
          </div>
          <div className="mt-0.5 text-[11.5px] text-faint" title={Object.entries(p.fields).map(([k, f]) => `${k}: ${f.source}, as of ${fmt(f.asOf)}`).join("\n")}>
            {p.sourceLabel}
            {field("current_title") ? ` · profile as of ${fmt(field("current_title").asOf)}` : ""} · retrieved {fmt(p.retrievedAt)}
          </div>
          <div className="mt-1 flex flex-wrap gap-1.5">
            {p.evidenceStatus !== "ok" && <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11.5px] text-warn">{p.staleReason ?? "Limited evidence"}</span>}
            {p.duplicateReason && <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[11.5px] text-ink-2">{p.duplicateReason}</span>}
            {p.excludedBy && <span className="rounded-md bg-danger-soft px-1.5 py-0.5 text-[11.5px] text-danger">Matches your approved exclusion “{p.excludedBy}”</span>}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1">
          {p.status === "saved" ? (
            <span className="text-[12.5px] font-medium text-ok">Saved to role</span>
          ) : (
            <>
              <ActionButton action={() => saveProfileToRole(p.id)} variant="primary" successMessage="Added to the pipeline at New — nothing was assessed or decided">
                Save to role
              </ActionButton>
              {p.status !== "dismissed" && (
                <ActionButton action={() => reviewProfile(p.id, { dismiss: true })} variant="ghost" successMessage="Dismissed from this search">
                  Dismiss
                </ActionButton>
              )}
            </>
          )}
        </div>
      </div>

      <ul className="mt-2.5 grid gap-1.5 sm:grid-cols-2">
        {p.signals.map((s, i) => (
          <li key={i} className="text-[12.5px]">
            <span className={clsx("font-medium", s.matched ? "text-ok" : "text-faint")}>
              {s.matched ? "✓" : "–"} {s.term}
            </span>
            <span className="text-faint"> · {CAT[s.category] ?? s.category}</span>
            {s.matched && s.quote ? (
              <div className="quote mt-0.5 truncate text-[11.5px] text-muted" title={s.quote}>
                “{s.quote}”{s.page ? ` — CV p.${s.page}` : ""}
              </div>
            ) : !s.matched ? (
              <div className="text-[11.5px] text-faint">Not found in the available profile — not evidence they lack it</div>
            ) : null}
          </li>
        ))}
      </ul>

      <div className="mt-2.5 flex flex-wrap items-center gap-2 text-[12px] text-muted">
        <span>Was this result useful?</span>
        <ActionButton action={() => reviewProfile(p.id, { feedback: "useful" })} variant={p.feedback === "useful" ? "primary" : "ghost"}>
          Useful
        </ActionButton>
        {reasonOpen ? (
          <select
            autoFocus
            className="h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12px]"
            defaultValue=""
            onChange={async (e) => {
              setReasonOpen(false);
              await reviewProfile(p.id, { feedback: "irrelevant", reason: e.target.value });
              window.location.reload();
            }}
          >
            <option value="" disabled>
              Why not relevant?
            </option>
            {REASONS.map((r) => (
              <option key={r}>{r}</option>
            ))}
          </select>
        ) : (
          <button type="button" onClick={() => setReasonOpen(true)} className={clsx("rounded-lg px-2.5 py-1 font-medium", p.feedback === "irrelevant" ? "bg-ink text-white" : "hover:bg-sunken")}>
            Not relevant
          </button>
        )}
      </div>
    </div>
  );
}
