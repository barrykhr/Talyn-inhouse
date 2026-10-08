"use client";

import clsx from "clsx";
import { useId, useRef, useState, type ReactNode } from "react";

/** Accessible tabs (arrow keys, Home/End). Panels are server-rendered and swapped instantly. */
export function Tabs({ tabs, initial = 0 }: { tabs: { label: string; count?: number | null; content: ReactNode }[]; initial?: number }) {
  const [active, setActive] = useState(initial);
  const id = useId();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const focus = (i: number) => {
    const n = (i + tabs.length) % tabs.length;
    setActive(n);
    refs.current[n]?.focus();
  };
  return (
    <div>
      <div role="tablist" className="mb-4 flex gap-1 border-b border-line">
        {tabs.map((t, i) => (
          <button
            key={t.label}
            ref={(el) => {
              refs.current[i] = el;
            }}
            role="tab"
            id={`${id}-tab-${i}`}
            aria-selected={active === i}
            aria-controls={`${id}-panel-${i}`}
            tabIndex={active === i ? 0 : -1}
            onClick={() => setActive(i)}
            onKeyDown={(e) => {
              if (e.key === "ArrowRight") focus(i + 1);
              else if (e.key === "ArrowLeft") focus(i - 1);
              else if (e.key === "Home") focus(0);
              else if (e.key === "End") focus(tabs.length - 1);
            }}
            className={clsx(
              "-mb-px flex items-center gap-1.5 border-b-2 px-3 py-2 text-[13.5px] font-medium transition-colors",
              active === i ? "border-ink text-ink" : "border-transparent text-muted hover:text-ink",
            )}
          >
            {t.label}
            {t.count ? <span className="text-[12px] tabular-nums text-faint">{t.count}</span> : null}
          </button>
        ))}
      </div>
      {tabs.map((t, i) => (
        <div key={t.label} role="tabpanel" id={`${id}-panel-${i}`} aria-labelledby={`${id}-tab-${i}`} hidden={active !== i} className={active === i ? "motion-fade" : undefined}>
          {t.content}
        </div>
      ))}
    </div>
  );
}

/**
 * The review panel: persistent and sticky on the right on large screens; on narrow screens a
 * bottom bar opens it as an accessible drawer (native <dialog>: focus trap, Esc to close).
 */
export function ReviewPanelShell({ children, summary }: { children: ReactNode; summary: ReactNode }) {
  const dialog = useRef<HTMLDialogElement>(null);
  return (
    <>
      <aside aria-label="Score, recommendation and decision" className="hidden lg:block">
        <div className="sticky top-6 max-h-[calc(100vh-3rem)] space-y-4 overflow-y-auto pb-6">{children}</div>
      </aside>
      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-4 py-2.5 backdrop-blur lg:hidden">
        <button
          type="button"
          onClick={() => dialog.current?.showModal()}
          className="flex w-full items-center justify-between gap-3 rounded-lg border border-line-strong bg-surface px-3 py-2 text-left text-[13px]"
          aria-haspopup="dialog"
        >
          <span className="min-w-0 truncate">{summary}</span>
          <span className="shrink-0 font-medium">Review &amp; decide ↑</span>
        </button>
      </div>
      <dialog
        ref={dialog}
        aria-label="Score, recommendation and decision"
        className="motion-drawer mb-0 mt-auto max-h-[88vh] w-full max-w-none rounded-t-2xl border border-line bg-paper p-0 lg:hidden"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-line bg-paper px-4 py-3">
          <span className="font-semibold">Review &amp; decide</span>
          <button type="button" onClick={() => dialog.current?.close()} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-sunken hover:text-ink">
            Close
          </button>
        </div>
        <div className="space-y-4 p-4">{children}</div>
      </dialog>
      <div className="h-16 lg:hidden" aria-hidden />
    </>
  );
}
