"use client";

import { useEffect, useRef, type ReactNode } from "react";

const OPEN_EVENT = "talyn:open-score-decision";

/**
 * The score-and-decision pop-up. Opens by itself right after an assessment finishes (?assessed=1),
 * and from any "Review score & decide" button. Native <dialog>: focus trap, Esc to close.
 */
export function ScoreDecisionDialog({ autoOpen, title, children }: { autoOpen: boolean; title: string; children: ReactNode }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const open = () => {
      if (ref.current && !ref.current.open) ref.current.showModal();
    };
    window.addEventListener(OPEN_EVENT, open);
    if (autoOpen) {
      open();
      // Don't reopen on refresh or after a decision re-renders the page.
      const u = new URL(window.location.href);
      u.searchParams.delete("assessed");
      window.history.replaceState(null, "", u.toString());
    }
    return () => window.removeEventListener(OPEN_EVENT, open);
  }, [autoOpen]);
  const close = () => ref.current?.close();
  return (
    <dialog
      ref={ref}
      aria-labelledby="score-dialog-title"
      onClick={(e) => e.target === ref.current && close()}
      className="motion-enter m-auto w-[min(720px,calc(100vw-24px))] max-h-[calc(100vh-32px)] overflow-y-auto rounded-2xl border border-line bg-surface p-0 text-ink shadow-xl backdrop:bg-ink/30"
    >
      <div className="sticky top-0 z-[1] flex items-center justify-between gap-3 border-b border-line bg-surface px-5 py-3">
        <h2 id="score-dialog-title" className="text-[15px] font-semibold">
          {title}
        </h2>
        <button type="button" onClick={close} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-sunken hover:text-ink">
          Close
        </button>
      </div>
      <div className="space-y-5 px-5 py-4" onClick={(e) => (e.target as HTMLElement).closest("[data-close-dialog]") && close()}>
        {children}
      </div>
    </dialog>
  );
}

export function OpenScoreDecisionButton({ label = "Review score & decide", className }: { label?: string; className?: string }) {
  return (
    <button
      type="button"
      onClick={() => window.dispatchEvent(new Event(OPEN_EVENT))}
      aria-haspopup="dialog"
      className={className ?? "inline-flex h-8 items-center rounded-lg bg-brand px-3 text-[13px] font-medium text-white hover:bg-brand-2"}
    >
      {label}
    </button>
  );
}
