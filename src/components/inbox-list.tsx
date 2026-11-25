"use client";

import clsx from "clsx";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import type { InboxGroup } from "@/lib/inbox";
import { markInboxItem } from "@/server/inbox-actions";

const since = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "");

/** Inbox items with their action, Done and Snooze. `limit` shows only the oldest few (Home). */
export function InboxList({ groups, limit, compact }: { groups: InboxGroup[]; limit?: number; compact?: boolean }) {
  const router = useRouter();
  const [gone, setGone] = useState<Set<string>>(new Set());
  const [leaving, setLeaving] = useState<Set<string>>(new Set());
  const clear = async (id: string, status: "done" | "snoozed") => {
    setLeaving((s) => new Set(s).add(id));
    setTimeout(() => setGone((s) => new Set(s).add(id)), 200);
    const r = await markInboxItem(id, status).catch(() => ({ ok: false }));
    if (!r.ok) {
      setGone((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      setLeaving((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
    } else router.refresh();
  };
  let shown = 0;
  const visible = groups
    .map((g) => ({ ...g, items: g.items.filter((i) => !gone.has(i.id)).filter(() => (limit === undefined ? true : shown++ < limit)) }))
    .filter((g) => g.items.length);
  if (!visible.length)
    return (
      <div className="motion-fade rounded-xl border border-line bg-surface px-4 py-8 text-center">
        <p className="text-[14px] font-semibold">You&apos;re all caught up</p>
        <p className="mt-1 text-[13px] text-muted">New applicants, results, drafts, replies and interviews appear here when they need you.</p>
      </div>
    );
  return (
    <div className="space-y-5">
      {visible.map((g) => (
        <section key={g.verb} aria-label={g.label}>
          {!compact && (
            <h2 className="mb-1.5 flex items-baseline gap-2 text-[13.5px] font-semibold">
              {g.label} <span className="text-[12px] font-normal tabular-nums text-muted">{g.items.length}</span>
            </h2>
          )}
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {g.items.map((it, i) => (
              <li key={it.id} className={clsx("motion-row flex flex-wrap items-center gap-3 px-4 py-2.5", leaving.has(it.id) && "motion-row-leave")} style={{ animationDelay: `${Math.min(i, 8) * 35}ms` }}>
                <div className="min-w-0 flex-1">
                  <Link href={it.href} className="block truncate text-[13.5px] font-medium hover:underline">
                    {compact && <span className="mr-1.5 text-[11.5px] font-semibold uppercase tracking-wide text-faint">{g.label}</span>}
                    {it.title}
                  </Link>
                  <p className="truncate text-[12.5px] text-muted">{it.detail}</p>
                </div>
                {it.at && <span className="hidden text-[11.5px] text-faint sm:inline">since {since(it.at)}</span>}
                <Link href={it.href} className="rounded-md border border-line-strong px-2 py-0.5 text-[12.5px] font-medium text-ink-2 transition-colors hover:border-brand hover:text-brand">
                  {it.action} →
                </Link>
                <button type="button" onClick={() => clear(it.id, "done")} className="rounded-md px-2 py-0.5 text-[12.5px] text-muted hover:bg-sunken hover:text-ink">
                  Done
                </button>
                <button type="button" onClick={() => clear(it.id, "snoozed")} className="rounded-md px-2 py-0.5 text-[12.5px] text-muted hover:bg-sunken hover:text-ink">
                  Snooze
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
