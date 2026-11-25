"use client";

import clsx from "clsx";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { getInbox, markInboxItem, markUpdatesSeen, type InboxView } from "@/server/inbox-actions";
import { Spinner } from "./client";

const ago = (iso: string | null) => {
  if (!iso) return "";
  const m = Math.max(1, Math.floor((Date.now() - Date.parse(iso)) / 60000));
  return m < 60 ? `${m}m` : m < 1440 ? `${Math.floor(m / 60)}h` : `${Math.floor(m / 1440)}d`;
};

export function BellIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 20 20" className={className} fill="none" aria-hidden>
      <path d="M10 2.75c-2.9 0-4.9 2.05-4.9 4.95v3.4L3.6 13.9h12.8l-1.5-2.8V7.7c0-2.9-2-4.95-4.9-4.95Z" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <path d="M8.1 16a2 2 0 0 0 3.8 0" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
    </svg>
  );
}

/**
 * The bell: everything waiting on you in one place. "Needs you" groups items by what to do, each
 * with its action, Done and Snooze; "Updates" is recent activity by others. The badge is the
 * product's only "needs you" count.
 */
export function InboxBell({ initialCount }: { initialCount: number }) {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState<"needs" | "updates">("needs");
  const [view, setView] = useState<InboxView | null>(null);
  const [count, setCount] = useState(initialCount);
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const [error, setError] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const path = usePathname();
  const router = useRouter();

  useEffect(() => setCount(initialCount), [initialCount]);
  useEffect(() => setOpen(false), [path]);

  const load = useCallback(async () => {
    setError(false);
    try {
      const v = await getInbox();
      setView(v);
      setCount(v.count);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    if (!open) return;
    void load();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, load]);

  useEffect(() => {
    if (open && tab === "updates" && view?.unseen) {
      void markUpdatesSeen();
      setView((v) => (v ? { ...v, unseen: 0 } : v));
    }
  }, [open, tab, view?.unseen]);

  const clear = async (id: string, status: "done" | "snoozed") => {
    setLeaving((s) => new Set(s).add(id));
    // Let the row collapse before it leaves the list.
    setTimeout(() => {
      setView((v) => (v ? { ...v, count: v.count - 1, groups: v.groups.map((g) => ({ ...g, items: g.items.filter((i) => i.id !== id) })).filter((g) => g.items.length) } : v));
      setCount((c) => Math.max(0, c - 1));
    }, 200);
    const r = await markInboxItem(id, status).catch(() => ({ ok: false }));
    if (!r.ok) void load();
    else router.refresh();
  };

  return (
    <div ref={ref} className="relative">
      <button
        ref={button}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
        aria-label={count ? `Inbox, ${count} item${count === 1 ? " needs" : "s need"} you` : "Inbox, nothing needs you"}
        className={clsx("relative flex h-9 w-9 items-center justify-center rounded-lg text-ink-2 transition-colors hover:bg-sunken hover:text-ink", open && "bg-sunken text-ink")}
      >
        <BellIcon className={clsx("h-[19px] w-[19px]", count > 0 && "motion-bell")} key={count} />
        {count > 0 && (
          <span className="motion-pop absolute -right-0.5 -top-0.5 min-w-[18px] rounded-full bg-brand px-1 text-center text-[10.5px] font-semibold leading-[18px] tabular-nums text-white" aria-hidden>
            {count > 99 ? "99+" : count}
          </span>
        )}
      </button>

      {open && (
        <div role="dialog" aria-label="Inbox" className="motion-panel absolute right-0 z-50 mt-2 flex max-h-[min(640px,78vh)] w-[min(440px,calc(100vw-24px))] origin-top-right flex-col overflow-hidden rounded-xl border border-line-strong bg-surface shadow-[0_18px_48px_-16px_rgba(16,24,40,0.28)]">
          <div className="flex items-center gap-1 border-b border-line px-2 pt-2">
            {(
              [
                ["needs", "Needs you", view?.count ?? count],
                ["updates", "Updates", view?.unseen ?? 0],
              ] as const
            ).map(([k, label, n]) => (
              <button
                key={k}
                type="button"
                onClick={() => setTab(k)}
                aria-pressed={tab === k}
                className={clsx("relative -mb-px flex items-center gap-1.5 border-b-2 px-3 pb-2 pt-1 text-[13px] font-medium transition-colors", tab === k ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink")}
              >
                {label}
                {n > 0 && <span className={clsx("rounded-full px-1.5 text-[11px] tabular-nums", tab === k ? "bg-ink text-white" : "bg-sunken text-ink-2")}>{n}</span>}
              </button>
            ))}
            <Link href="/inbox" className="ml-auto pb-2 pr-2 text-[12.5px] text-muted hover:text-ink">
              Open inbox →
            </Link>
          </div>

          <div className="min-h-[120px] flex-1 overflow-y-auto">
            {!view && !error && (
              <div className="flex items-center gap-2 px-4 py-6 text-[13px] text-muted">
                <Spinner /> Loading…
              </div>
            )}
            {error && (
              <div className="px-4 py-6 text-[13px]">
                Couldn&apos;t load your inbox.{" "}
                <button type="button" className="font-medium text-brand underline" onClick={load}>
                  Try again
                </button>
              </div>
            )}
            {view && tab === "needs" && (
              view.groups.length === 0 ? (
                <div className="motion-fade px-4 py-10 text-center">
                  <p className="text-[14px] font-semibold">You&apos;re all caught up</p>
                  <p className="mt-1 text-[12.5px] text-muted">New applicants, results, drafts, replies and interviews appear here when they need you.</p>
                </div>
              ) : (
                view.groups.map((g) => (
                  <section key={g.verb} aria-label={g.label}>
                    <div className="sticky top-0 z-10 flex items-center justify-between bg-surface/95 px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-faint backdrop-blur">
                      {g.label}
                      <span className="tabular-nums">{g.items.length}</span>
                    </div>
                    <ul>
                      {g.items.map((it, i) => (
                        <li key={it.id} className={clsx("motion-row group", leaving.has(it.id) && "motion-row-leave")} style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                          <div className="flex items-start gap-3 px-4 py-2.5 hover:bg-sunken/60">
                            <div className="min-w-0 flex-1">
                              <Link href={it.href} className="block truncate text-[13.5px] font-medium hover:underline">
                                {it.title}
                              </Link>
                              <p className="truncate text-[12.5px] text-muted">{it.detail}</p>
                            </div>
                            <span className="shrink-0 pt-0.5 text-[11.5px] tabular-nums text-faint">{ago(it.at)}</span>
                          </div>
                          <div className="-mt-1 flex items-center gap-1 px-4 pb-2.5">
                            <Link href={it.href} className="rounded-md border border-line-strong px-2 py-0.5 text-[12px] font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand">
                              {it.action} →
                            </Link>
                            <button type="button" onClick={() => clear(it.id, "done")} className="rounded-md px-2 py-0.5 text-[12px] text-muted transition-colors hover:bg-sunken hover:text-ink">
                              Done
                            </button>
                            <button type="button" onClick={() => clear(it.id, "snoozed")} className="rounded-md px-2 py-0.5 text-[12px] text-muted transition-colors hover:bg-sunken hover:text-ink">
                              Snooze 1 day
                            </button>
                          </div>
                        </li>
                      ))}
                    </ul>
                  </section>
                ))
              )
            )}
            {view && tab === "updates" && (
              view.updates.length === 0 ? (
                <p className="motion-fade px-4 py-10 text-center text-[12.5px] text-muted">No activity from others in the last 14 days.</p>
              ) : (
                <ul className="py-1">
                  {view.updates.map((u, i) => (
                    <li key={u.id} className="motion-row" style={{ animationDelay: `${Math.min(i, 8) * 30}ms` }}>
                      {u.href ? (
                        <Link href={u.href} className="flex gap-2 px-4 py-2 text-[13px] hover:bg-sunken/60">
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{u.actor}</span> <span className="text-ink-2">{u.text}</span>
                          </span>
                          <span className="shrink-0 text-[11.5px] text-faint">{ago(u.at)}</span>
                        </Link>
                      ) : (
                        <div className="flex gap-2 px-4 py-2 text-[13px]">
                          <span className="min-w-0 flex-1">
                            <span className="font-medium">{u.actor}</span> <span className="text-ink-2">{u.text}</span>
                          </span>
                          <span className="shrink-0 text-[11.5px] text-faint">{ago(u.at)}</span>
                        </div>
                      )}
                    </li>
                  ))}
                </ul>
              )
            )}
          </div>
          <p className="border-t border-line px-4 py-2 text-[11.5px] text-faint">Done hides an item until it changes. Nothing here decides or sends anything.</p>
        </div>
      )}
    </div>
  );
}
