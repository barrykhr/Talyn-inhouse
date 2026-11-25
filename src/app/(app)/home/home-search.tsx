"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { quickSearch, type SearchHit } from "@/server/search-actions";

const SCOPES = [
  ["all", "Everyone"],
  ["candidate", "Your candidates"],
  ["sourced", "Found in Discover"],
] as const;

/**
 * The Home search box: describe who you're looking for and Talyn searches the whole talent pool by
 * meaning; type a name and it offers to jump to that role or candidate. Searching never contacts
 * or decides anything.
 */
export function HomeSearch({ suggestions, meaningReady, meaningNote }: { suggestions: string[]; meaningReady: boolean; meaningNote: string | null }) {
  const id = useId();
  const router = useRouter();
  const box = useRef<HTMLTextAreaElement>(null);
  const [q, setQ] = useState("");
  const [scope, setScope] = useState<(typeof SCOPES)[number][0]>("all");
  const [hits, setHits] = useState<SearchHit[]>([]);
  const [going, setGoing] = useState(false);

  // Name matches for roles and candidates while typing (short queries only).
  useEffect(() => {
    const t = q.trim();
    if (t.length < 2 || t.length > 60) {
      setHits([]);
      return;
    }
    let live = true;
    const h = setTimeout(async () => {
      try {
        const r = await quickSearch(t);
        if (live) setHits(r.slice(0, 6));
      } catch {
        if (live) setHits([]);
      }
    }, 220);
    return () => {
      live = false;
      clearTimeout(h);
    };
  }, [q]);

  // Grow with the text, up to a limit.
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    el.style.height = "auto";
    el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
  }, [q]);

  const submit = (text = q) => {
    const t = text.trim();
    if (t.length < 3 || !meaningReady) return;
    setGoing(true);
    router.push(`/candidates/search?q=${encodeURIComponent(t)}${scope === "all" ? "" : `&in=${scope}`}`);
  };

  return (
    <div className="w-full max-w-[720px]">
      <form
        role="search"
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="rounded-2xl border border-line-strong bg-surface shadow-[0_1px_2px_rgba(16,24,40,0.04),0_8px_24px_-12px_rgba(16,24,40,0.12)] transition-shadow focus-within:border-brand focus-within:shadow-[0_0_0_3px_var(--color-brand-soft),0_8px_24px_-12px_rgba(16,24,40,0.12)]"
      >
        <label htmlFor={`${id}-q`} className="sr-only">
          Describe who you&apos;re looking for, or search roles and candidates by name
        </label>
        <textarea
          id={`${id}-q`}
          ref={box}
          value={q}
          rows={2}
          maxLength={500}
          autoFocus
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Describe who you're looking for — e.g. a backend engineer who has scaled payments, Go or Java"
          className="block w-full resize-none rounded-2xl bg-transparent px-4 pb-1 pt-3.5 text-[15.5px] leading-relaxed placeholder:text-faint"
          // The outer box shows focus (border and ring); this keeps a second ring from drawing inside it.
          style={{ outline: "none" }}
        />
        <div className="flex items-center gap-2 px-3 pb-2.5">
          <label htmlFor={`${id}-scope`} className="sr-only">
            Search in
          </label>
          <select
            id={`${id}-scope`}
            value={scope}
            onChange={(e) => setScope(e.target.value as typeof scope)}
            className="h-8 rounded-lg border border-line bg-surface px-2 text-[12.5px] text-ink-2 hover:bg-sunken"
          >
            {SCOPES.map(([k, l]) => (
              <option key={k} value={k}>
                {l}
              </option>
            ))}
          </select>
          <span className="hidden text-[12px] text-faint sm:inline">Matches by meaning · Enter to search · Shift+Enter for a new line</span>
          <button
            type="submit"
            aria-label="Search"
            disabled={q.trim().length < 3 || !meaningReady || going}
            className="ml-auto flex h-9 w-9 items-center justify-center rounded-xl bg-ink text-white transition-opacity disabled:opacity-30"
          >
            <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" aria-hidden>
              <path d="M8 13V3M3.5 7.5 8 3l4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </form>

      {hits.length > 0 && (
        <div className="mt-2 overflow-hidden rounded-xl border border-line bg-surface">
          <div className="px-3 pt-2 text-[11.5px] font-semibold uppercase tracking-wide text-muted">Jump to</div>
          <ul>
            {hits.map((h) => (
              <li key={`${h.kind}-${h.id}`}>
                <Link href={h.href} className="flex items-center gap-2 px-3 py-1.5 text-[13.5px] hover:bg-sunken">
                  <span className="w-16 shrink-0 text-[11.5px] text-faint">{h.kind === "role" ? "Role" : "Candidate"}</span>
                  <span className="font-medium">{h.title}</span>
                  {h.subtitle && <span className="truncate text-muted">· {h.subtitle}</span>}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      {!meaningReady && meaningNote && <p className="mt-2 text-center text-[12.5px] text-warn">{meaningNote} You can still jump to roles and candidates by name.</p>}

      {hits.length === 0 && suggestions.length > 0 && (
        <div className="mt-4 flex flex-wrap justify-center gap-2" aria-label="Suggested searches">
          {suggestions.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setQ(s);
                submit(s);
              }}
              disabled={!meaningReady}
              className={clsx("rounded-full border border-line bg-surface px-3 py-1.5 text-[12.5px] text-ink-2 hover:border-line-strong hover:bg-sunken disabled:opacity-50")}
            >
              {s}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
