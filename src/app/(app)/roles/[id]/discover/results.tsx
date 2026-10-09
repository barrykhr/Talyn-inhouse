"use client";

import clsx from "clsx";
import Link from "next/link";
import { useId, useState } from "react";
import { ActionButton } from "@/components/client";
import { SampleBadge } from "@/components/role-workspace";
import { useToast } from "@/components/toast";
import { reviewProfile, saveProfileToRole } from "@/server/sourcing-actions";

export type ProfileView = {
  id: string;
  roleId: string;
  source: string;
  sourceLabel: string;
  sourceUrl: string | null;
  retrievedAt: string;
  displayName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  fields: Record<string, { value: string; source: string; asOf: string }>;
  signals: { category: string; term: string; matched: boolean; quote: string | null; page: number | null; note?: string | null; source?: string }[];
  sources: { key: string; label: string; url: string | null; recordId: string; retrievedAt: string }[];
  isDemo: boolean;
  matchedSignals: number;
  totalSignals: number;
  evidenceStatus: string;
  staleReason: string | null;
  duplicateReason: string | null;
  status: string;
  excludedBy: string | null;
  feedback: string | null;
  savedApplicationId: string | null;
  savedCandidateId: string | null;
  /** Once saved: what the candidate has said, and contact permission — kept apart from role fit. */
  application: { interest: string; permission: string } | null;
};

const CAT: Record<string, string> = {
  keyword: "Query",
  title: "Title",
  adjacent_title: "Alternative title",
  skill_required: "Required skill",
  skill_preferred: "Preferred skill",
  location: "Location",
  seniority: "Seniority",
  experience: "Experience",
};
const INTEREST_LABEL: Record<string, string> = { not_expressed: "None expressed", interested: "Said they're interested", not_now: "Said not now", declined: "Declined" };
const REASONS = ["Wrong title or function", "Missing key skills", "Wrong location", "Seniority mismatch", "Already known / contacted", "Other"];
const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function NotEstablished({ what }: { what: string }) {
  return <span className="italic text-faint">{what} not available from source</span>;
}

/** Plain-language reason this person appeared, from matched evidence only. */
function whyAppeared(p: ProfileView) {
  const m = p.signals.filter((s) => s.matched);
  const titles = m.filter((s) => s.category === "title" || s.category === "adjacent_title").map((s) => s.term);
  const skills = m.filter((s) => s.category.startsWith("skill")).map((s) => s.term);
  const parts = [
    titles.length ? `title matches ${titles.map((t) => `“${t}”`).join(" / ")}` : null,
    skills.length ? `profile mentions ${skills.slice(0, 5).join(", ")}${skills.length > 5 ? ` +${skills.length - 5}` : ""}` : null,
    m.some((s) => s.category === "location") ? "location matches" : null,
    m.some((s) => s.category === "experience") ? "stated experience is in range" : null,
  ].filter(Boolean);
  return parts.length ? `Appeared because the ${parts.join("; ")}.` : "Appeared on a weak match — check the evidence.";
}

/** One Discover result. Everything shown comes from the sources; gaps are labeled, never filled in. */
export function ResultCard({ p, outreachHref }: { p: ProfileView; outreachHref: string | null }) {
  const [open, setOpen] = useState(false);
  const [dismissing, setDismissing] = useState(false);
  const toast = useToast();
  const id = useId();
  const matched = p.signals.filter((s) => s.matched);
  const unmatched = p.signals.filter((s) => !s.matched);
  const skills = matched.filter((s) => s.category.startsWith("skill"));
  const sources = p.sources.length ? p.sources : [{ key: p.source, label: p.sourceLabel, url: p.sourceUrl, recordId: "", retrievedAt: p.retrievedAt }];

  return (
    <article aria-labelledby={`${id}-name`} className={clsx("px-4 py-4", p.status === "dismissed" && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${id}-name`} className="font-medium">
              {p.displayName || <NotEstablished what="Name" />}
            </h3>
            {p.isDemo && <SampleBadge />}
            {p.duplicateReason && <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[11.5px] text-ink-2">{p.duplicateReason}</span>}
          </div>
          <div className="flex flex-wrap gap-x-2 text-[12.5px] text-ink-2">
            <span>{p.currentTitle ?? <NotEstablished what="Role" />}</span>
            {p.currentCompany && (
              <>
                <span aria-hidden className="text-faint">·</span>
                <span>{p.currentCompany}</span>
              </>
            )}
            <span aria-hidden className="text-faint">·</span>
            <span>{p.location ?? <NotEstablished what="Location" />}</span>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={`${id}-ev`}
            onClick={() => setOpen(!open)}
            className={clsx("h-8 rounded-lg border px-3 text-[13px] font-medium", open ? "border-ink bg-ink text-white" : "border-line-strong bg-surface hover:bg-sunken")}
          >
            {open ? "Hide evidence" : "Open evidence"}
          </button>
          {p.status === "saved" ? (
            <>
              <span className="px-1 text-[12.5px] font-medium text-ok">Saved · Discovered</span>
              {outreachHref && (
                <Link href={outreachHref} className="inline-flex h-8 items-center rounded-lg bg-ink px-3 text-[13px] font-medium text-white">
                  Outreach
                </Link>
              )}
              {p.savedCandidateId && (
                <Link href={`/candidates/${p.savedCandidateId}?role=${p.roleId}`} className="px-2 text-[12.5px] underline hover:text-ink">
                  Profile
                </Link>
              )}
            </>
          ) : (
            <>
              <ActionButton action={() => saveProfileToRole(p.id)} variant="primary" size="md" pendingLabel="Saving…" successMessage="Saved to the role as Discovered — nothing was assessed or sent">
                Save to role
              </ActionButton>
              {p.status !== "dismissed" &&
                (dismissing ? (
                  <select
                    autoFocus
                    aria-label="Why dismiss? (optional)"
                    className="h-8 rounded-lg border border-line-strong bg-surface px-1.5 text-[12.5px]"
                    defaultValue=""
                    onChange={async (e) => {
                      await reviewProfile(p.id, { dismiss: true, feedback: "irrelevant", reason: e.target.value === "skip" ? undefined : e.target.value });
                      toast({ message: "Dismissed from this search" });
                      window.location.reload();
                    }}
                    onBlur={() => setDismissing(false)}
                  >
                    <option value="" disabled>
                      Why dismiss?
                    </option>
                    {REASONS.map((r) => (
                      <option key={r}>{r}</option>
                    ))}
                    <option value="skip">Skip — no reason</option>
                  </select>
                ) : (
                  <button type="button" onClick={() => setDismissing(true)} className="h-8 rounded-lg px-3 text-[13px] font-medium text-muted hover:bg-sunken hover:text-ink">
                    Dismiss
                  </button>
                ))}
            </>
          )}
        </div>
      </div>

      <p className="mt-1.5 text-[12.5px] text-ink-2">{whyAppeared(p)}</p>

      {skills.length > 0 && (
        <ul className="mt-1.5 flex flex-wrap gap-1.5" aria-label="Skills supported by evidence">
          {skills.map((s, i) => (
            <li key={i} className="rounded-md bg-ok-soft px-1.5 py-0.5 text-[11.5px] text-ok" title={s.quote ? `“${s.quote}” — ${s.source ?? p.sourceLabel}` : undefined}>
              ✓ {s.term}
            </li>
          ))}
        </ul>
      )}

      <dl className="mt-2 grid gap-x-4 gap-y-1 rounded-lg bg-sunken/60 px-3 py-2 text-[12px] sm:grid-cols-3">
        <div>
          <dt className="font-semibold uppercase tracking-wide text-faint">Role fit evidence</dt>
          <dd className="text-ink-2">
            {p.matchedSignals} of {p.totalSignals} search terms found with a quote
          </dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wide text-faint">Expressed interest</dt>
          <dd className="text-ink-2">{p.application ? INTEREST_LABEL[p.application.interest] ?? "None expressed" : "None — not inferred from public activity"}</dd>
        </div>
        <div>
          <dt className="font-semibold uppercase tracking-wide text-faint">Permission to contact</dt>
          <dd className="text-ink-2">{p.application?.permission ?? "Not recorded"}</dd>
        </div>
      </dl>

      <div className="mt-2 flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] text-muted">
        {sources.map((s, i) => (
          <span key={i}>
            {s.key === "talyn" && s.url ? (
              <Link href={s.url} className="underline hover:text-ink">
                {s.label}
              </Link>
            ) : s.url ? (
              <a href={s.url} target="_blank" rel="noopener noreferrer nofollow" className="underline hover:text-ink">
                {s.label} ↗
              </a>
            ) : (
              <span>{s.label} {s.key === "sample" ? "(no link — fictional)" : "(no link provided)"}</span>
            )}{" "}
            · retrieved {fmt(s.retrievedAt)}
          </span>
        ))}
        {sources.length > 1 && <span className="text-ink-2">Same person found in {sources.length} sources — merged</span>}
        {p.evidenceStatus !== "ok" && p.staleReason && <span className="text-warn">{p.staleReason}</span>}
        {p.excludedBy && <span className="text-danger">Matches your exclusion “{p.excludedBy}”</span>}
      </div>

      {open && (
        <div id={`${id}-ev`} className="motion-fade mt-3 grid gap-4 rounded-lg border border-line bg-[#fbfaf7] p-3 md:grid-cols-2">
          <div>
            <h4 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Found in the profile</h4>
            {matched.length === 0 ? (
              <p className="text-[12.5px] text-faint">None of the search terms were found with a quote.</p>
            ) : (
              <ul className="space-y-2">
                {matched.map((s, i) => (
                  <li key={i} className="rounded-md border-l-2 border-ok bg-surface px-2.5 py-1.5 text-[12.5px]">
                    <div className="font-medium">
                      {s.term} <span className="font-normal text-faint">· {CAT[s.category] ?? s.category}</span>
                    </div>
                    {s.quote && (
                      <p className="quote text-ink-2">
                        “{s.quote}”{s.page ? <span className="text-faint"> — CV p.{s.page}</span> : null}
                      </p>
                    )}
                    {s.note && <p className="text-[11.5px] text-muted">{s.note}</p>}
                    <div className="text-[11px] text-faint">From {s.source ?? p.sourceLabel}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <h4 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Uncertain or not available</h4>
              {unmatched.length === 0 ? (
                <p className="text-[12.5px] text-faint">Every search term was found.</p>
              ) : (
                <ul className="space-y-0.5 text-[12.5px]">
                  {unmatched.map((s, i) => (
                    <li key={i} className="text-ink-2">
                      <span className="text-faint">?</span> {s.term} <span className="text-faint">· {CAT[s.category] ?? s.category}</span>
                      {s.note && <span className="block pl-3 text-[11.5px] text-warn">{s.note}</span>}
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[11.5px] text-faint">Not found in the available profile — that is not evidence the person lacks it.</p>
            </div>
            <div>
              <h4 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Not known from any source</h4>
              <ul className="space-y-0.5 text-[12.5px] text-ink-2">
                <li>Whether they want a new job — Talyn doesn&apos;t infer this from profiles or public activity</li>
                <li>{p.fields.email ? `Email provided by ${p.fields.email.source}` : "Contact details — none provided; Talyn doesn't look them up or guess them"}</li>
              </ul>
            </div>
            {Object.keys(p.fields).length > 0 && (
              <div>
                <h4 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Field sources</h4>
                <ul className="space-y-0.5 text-[11.5px] text-muted">
                  {Object.entries(p.fields).map(([k, f]) => (
                    <li key={k}>
                      {k.replace(/_/g, " ")}: {f.source}, as of {fmt(f.asOf)}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      )}
    </article>
  );
}
