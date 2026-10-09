"use client";

import clsx from "clsx";
import Link from "next/link";
import { useId, useState } from "react";
import { ActionButton, Spinner } from "@/components/client";
import { SampleBadge } from "@/components/role-workspace";
import { useToast } from "@/components/toast";
import { draftDiscoverMessage, reviewProfile, saveProfileToRole, type MessageDraft } from "@/server/sourcing-actions";

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
  savedCandidateId: string | null;
};

const CAT: Record<string, string> = {
  keyword: "Query",
  title: "Title",
  adjacent_title: "Adjacent title",
  skill_required: "Skill",
  skill_preferred: "Nice-to-have",
  location: "Location",
  seniority: "Seniority",
};
const REASONS = ["Wrong title or function", "Missing key skills", "Wrong location", "Seniority mismatch", "Already known / contacted", "Other"];
const fmt = (d: string) => new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

function NotEstablished({ what }: { what: string }) {
  return <span className="italic text-faint">{what} not established by source</span>;
}

/** One Discover result. Everything shown comes from the source; gaps are labeled, never filled in. */
export function ResultCard({ p, emailProviderConnected }: { p: ProfileView; emailProviderConnected: boolean }) {
  const [open, setOpen] = useState<"evidence" | "message" | null>(null);
  const [dismissing, setDismissing] = useState(false);
  const toast = useToast();
  const evId = useId();
  const sample = p.source === "sample";
  const matched = p.signals.filter((s) => s.matched);
  const unmatched = p.signals.filter((s) => !s.matched);
  const profileAsOf = p.fields.current_title?.asOf ?? p.fields.location?.asOf ?? null;
  const email = p.fields.email?.value ?? null;

  return (
    <article aria-labelledby={`${evId}-name`} className={clsx("px-4 py-4", p.status === "dismissed" && "opacity-60")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="flex flex-wrap items-center gap-2">
            <h3 id={`${evId}-name`} className="font-medium">
              {p.source === "talyn" && p.sourceUrl ? (
                <Link href={p.sourceUrl} className="hover:underline">
                  {p.displayName}
                </Link>
              ) : (
                p.displayName
              )}
            </h3>
            {sample && <SampleBadge />}
            <span className="text-[12px] text-muted">
              {p.matchedSignals} of {p.totalSignals} search terms found in the profile
            </span>
          </div>
          <div className="flex flex-wrap gap-x-2 text-[12.5px] text-ink-2">
            <span>{p.currentTitle ?? <NotEstablished what="Title" />}</span>
            <span aria-hidden className="text-faint">·</span>
            <span>{p.currentCompany ?? <NotEstablished what="Company" />}</span>
            <span aria-hidden className="text-faint">·</span>
            <span>{p.location ?? <NotEstablished what="Location" />}</span>
          </div>
          <div className="flex flex-wrap gap-x-2 text-[11.5px] text-muted">
            <span>
              Source: <span className="font-medium text-ink-2">{p.sourceLabel}</span>
            </span>
            {p.sourceUrl ? (
              p.source === "talyn" ? (
                <Link href={p.sourceUrl} className="underline hover:text-ink">
                  Talyn record
                </Link>
              ) : (
                <a href={p.sourceUrl} target="_blank" rel="noopener noreferrer nofollow" className="underline hover:text-ink">
                  View at source ↗
                </a>
              )
            ) : (
              <span className="text-faint">{sample ? "No source link — fictional sample" : "No source link provided"}</span>
            )}
            <span>· Found {fmt(p.retrievedAt)}</span>
            <span>· {profileAsOf && !p.staleReason?.includes("didn't say") ? `Profile as of ${fmt(profileAsOf)}` : "Profile date not established"}</span>
          </div>
          <div className="flex flex-wrap gap-1.5 pt-1">
            {p.evidenceStatus !== "ok" && p.staleReason && <span className="rounded-md bg-warn-soft px-1.5 py-0.5 text-[11.5px] text-warn">{p.staleReason}</span>}
            {p.duplicateReason && <span className="rounded-md bg-sunken px-1.5 py-0.5 text-[11.5px] text-ink-2">{p.duplicateReason}</span>}
            {p.excludedBy && <span className="rounded-md bg-danger-soft px-1.5 py-0.5 text-[11.5px] text-danger">Matches your exclusion “{p.excludedBy}”</span>}
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            aria-expanded={open === "evidence"}
            aria-controls={`${evId}-ev`}
            onClick={() => setOpen(open === "evidence" ? null : "evidence")}
            className={clsx("h-8 rounded-lg border px-3 text-[13px] font-medium", open === "evidence" ? "border-ink bg-ink text-white" : "border-line-strong bg-surface hover:bg-sunken")}
          >
            View evidence
          </button>
          {p.status === "saved" ? (
            <span className="flex items-center gap-2 px-1 text-[12.5px]">
              <span className="font-medium text-ok">Saved · Discovered</span>
              {p.savedCandidateId && (
                <Link href={`/candidates/${p.savedCandidateId}?role=${p.roleId}`} className="underline hover:text-ink">
                  Open
                </Link>
              )}
            </span>
          ) : (
            <>
              <ActionButton action={() => saveProfileToRole(p.id)} variant="primary" size="md" pendingLabel="Saving…" successMessage="Saved as Discovered and added to the Shortlist — nothing was assessed or sent">
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
          <button
            type="button"
            aria-expanded={open === "message"}
            onClick={() => setOpen(open === "message" ? null : "message")}
            className={clsx("h-8 rounded-lg px-3 text-[13px] font-medium", open === "message" ? "bg-sunken text-ink" : "text-muted hover:bg-sunken hover:text-ink")}
          >
            Draft message
          </button>
        </div>
      </div>

      {/* Compact evidence preview: matched terms only. */}
      {open !== "evidence" && matched.length > 0 && (
        <ul className="mt-2 flex flex-wrap gap-1.5" aria-label="Matched search terms">
          {matched.map((s, i) => (
            <li key={i} className="rounded-md bg-ok-soft px-1.5 py-0.5 text-[11.5px] text-ok" title={s.quote ? `“${s.quote}”` : undefined}>
              ✓ {s.term}
            </li>
          ))}
        </ul>
      )}

      {open === "evidence" && (
        <div id={`${evId}-ev`} className="motion-fade mt-3 grid gap-4 rounded-lg border border-line bg-[#fbfaf7] p-3 md:grid-cols-2">
          <div>
            <h4 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Found in the profile</h4>
            {matched.length === 0 ? (
              <p className="text-[12.5px] text-faint">None of your search terms were found with a quote.</p>
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
                    <div className="text-[11px] text-faint">From {p.sourceLabel}</div>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div className="space-y-3">
            <div>
              <h4 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Not established by this source</h4>
              {unmatched.length === 0 ? (
                <p className="text-[12.5px] text-faint">Every search term was found.</p>
              ) : (
                <ul className="space-y-0.5 text-[12.5px]">
                  {unmatched.map((s, i) => (
                    <li key={i} className="text-ink-2">
                      <span className="text-faint">?</span> {s.term} <span className="text-faint">· {CAT[s.category] ?? s.category}</span>
                    </li>
                  ))}
                </ul>
              )}
              <p className="mt-1 text-[11.5px] text-faint">Not found in the available profile — that is not evidence the person lacks it.</p>
            </div>
            <div>
              <h4 className="mb-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Not known from this source</h4>
              <ul className="space-y-0.5 text-[12.5px] text-ink-2">
                <li>Interest in this role or in changing jobs — unknown</li>
                <li>Permission to contact — not established</li>
                <li>{email ? `Email provided by ${p.fields.email.source}` : "Contact details — none provided (Talyn doesn't look them up or guess them)"}</li>
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

      {open === "message" && <MessageDraftPanel profileId={p.id} name={p.displayName} email={email} sample={sample} saved={p.status === "saved"} savedCandidateId={p.savedCandidateId} roleId={p.roleId} emailProviderConnected={emailProviderConnected} />}
    </article>
  );
}

/** Draft a first message from role evidence. Draft only: nothing is saved or sent from here. */
function MessageDraftPanel({
  profileId,
  name,
  email,
  sample,
  saved,
  savedCandidateId,
  roleId,
  emailProviderConnected,
}: {
  profileId: string;
  name: string;
  email: string | null;
  sample: boolean;
  saved: boolean;
  savedCandidateId: string | null;
  roleId: string;
  emailProviderConnected: boolean;
}) {
  const [channel, setChannel] = useState<"email" | "whatsapp">("email");
  const [draft, setDraft] = useState<MessageDraft | null>(null);
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const id = useId();

  const generate = async (ch: "email" | "whatsapp") => {
    setBusy(true);
    setCopied(false);
    const d = await draftDiscoverMessage(profileId, ch).catch(() => ({ error: "Couldn't draft a message. Try again." }) as MessageDraft);
    setBusy(false);
    setDraft(d);
    setSubject(d.subject ?? "");
    setBody(d.body ?? "");
  };
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(channel === "email" && subject ? `Subject: ${subject}\n\n${body}` : body);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <section aria-label={`Message draft for ${name}`} className="motion-fade mt-3 rounded-lg border border-line bg-surface p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-lg border border-line-strong p-0.5 text-[12.5px]" role="radiogroup" aria-label="Channel">
          {(["email", "whatsapp"] as const).map((c) => (
            <button
              key={c}
              type="button"
              role="radio"
              aria-checked={channel === c}
              onClick={() => {
                setChannel(c);
                if (draft) generate(c);
              }}
              className={clsx("rounded-md px-2.5 py-1 font-medium", channel === c ? "bg-ink text-white" : "text-muted hover:text-ink")}
            >
              {c === "email" ? "Email" : "WhatsApp"}
            </button>
          ))}
        </div>
        <button type="button" onClick={() => generate(channel)} disabled={busy} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line-strong px-3 text-[12.5px] font-medium hover:bg-sunken disabled:opacity-60">
          {busy && <Spinner />}
          {draft ? "Redraft" : "Draft from evidence"}
        </button>
      </div>

      <Notice>
        <strong>Draft only — nothing is sent from here.</strong>{" "}
        {channel === "whatsapp"
          ? "Talyn has no WhatsApp integration. If you have permission to contact this person, copy the text into WhatsApp yourself."
          : emailProviderConnected && saved && email
            ? "To send by email, open the candidate's Outreach tab, where every message needs your approval."
            : "Copy it into your own email client."}{" "}
        {sample ? "This is a fictional sample person — there is no one to contact." : !email ? "No contact details came from this source, and Talyn doesn't guess them." : ""}
      </Notice>

      {draft?.error && <p className="mt-2 text-[12.5px] text-danger">{draft.error}</p>}
      {draft && !draft.error && (
        <div className="mt-2 space-y-2">
          {channel === "email" && (
            <div>
              <label htmlFor={`${id}-s`} className="text-[12px] font-medium">
                Subject
              </label>
              <input id={`${id}-s`} value={subject} onChange={(e) => setSubject(e.target.value)} className="mt-0.5 h-8 w-full rounded-md border border-line-strong px-2 text-[13px]" />
            </div>
          )}
          <div>
            <label htmlFor={`${id}-b`} className="text-[12px] font-medium">
              Message
            </label>
            <textarea id={`${id}-b`} value={body} onChange={(e) => setBody(e.target.value)} rows={channel === "email" ? 9 : 5} className="mt-0.5 w-full rounded-md border border-line-strong px-2 py-1.5 text-[13px] leading-relaxed" />
          </div>
          <div className="text-[11.5px] text-muted">
            {draft.generator.startsWith("ai:") ? "Drafted by AI from the facts below — check every claim." : "Drafted from a template using the facts below (not AI)."} Uses only:
            <ul className="mt-0.5 list-disc pl-5">
              {draft.facts.length ? (
                draft.facts.map((f, i) => (
                  <li key={i}>
                    {f.label}: “{f.value}” <span className="text-faint">({f.source})</span>
                  </li>
                ))
              ) : (
                <li>The role title — no matched evidence to reference.</li>
              )}
            </ul>
            It doesn&apos;t claim the person is looking for a job or interested.
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={copy} className="h-8 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-white">
              Copy text
            </button>
            {copied && (
              <span role="status" className="text-[12px] text-ok">
                Copied — not sent
              </span>
            )}
            {saved && savedCandidateId && channel === "email" && (
              <Link href={`/candidates/${savedCandidateId}?role=${roleId}&view=outreach`} className="text-[12.5px] underline hover:text-ink">
                Open Outreach tab
              </Link>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

function Notice({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 rounded-md bg-sunken px-2.5 py-1.5 text-[12px] text-ink-2">{children}</p>;
}
