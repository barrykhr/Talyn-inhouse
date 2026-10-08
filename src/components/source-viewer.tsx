"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { highlight } from "@/lib/highlight";

// Perplexity-style source inspection: any citation can open the original CV text with the
// quoted passage highlighted and scrolled into view, without leaving the assessment.

type Target = { source: "resume" | "profile"; page?: number | null; quote: string; label: string };
const Ctx = createContext<((t: Target) => void) | null>(null);

export function useSourceViewer() {
  return useContext(Ctx);
}

export function SourceViewerProvider({
  pages,
  profileText,
  fileName,
  children,
}: {
  pages: string[];
  profileText: string;
  fileName: string | null;
  children: ReactNode;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const body = useRef<HTMLDivElement>(null);
  const [target, setTarget] = useState<Target | null>(null);

  const open = (t: Target) => {
    setTarget(t);
    dialog.current?.showModal();
  };
  useEffect(() => {
    if (!target) return;
    const t = setTimeout(() => body.current?.querySelector("mark")?.scrollIntoView({ block: "center" }), 30);
    return () => clearTimeout(t);
  }, [target]);

  const shownPages = target?.source === "profile" ? [profileText] : pages;
  return (
    <Ctx.Provider value={open}>
      {children}
      <dialog
        ref={dialog}
        aria-label="Source"
        className="motion-sheet my-0 ml-auto mr-0 h-full max-h-none w-[min(560px,100vw)] border-l border-line bg-surface p-0"
        onClick={(e) => e.target === dialog.current && dialog.current?.close()}
        onClose={() => setTarget(null)}
      >
        <div className="flex h-full flex-col">
          <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
            <div className="min-w-0">
              <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Source</div>
              <div className="truncate font-medium">{target?.source === "profile" ? "Candidate-provided information" : (fileName ?? "CV")}</div>
              {target && <div className="text-[12.5px] text-muted">{target.label}</div>}
            </div>
            <button type="button" onClick={() => dialog.current?.close()} className="rounded-md px-2 py-1 text-[13px] text-muted hover:bg-sunken hover:text-ink" autoFocus>
              Close <kbd className="ml-1">esc</kbd>
            </button>
          </div>
          <div ref={body} className="flex-1 space-y-5 overflow-y-auto bg-[#fbfaf7] px-5 py-4">
            {target &&
              shownPages.map((p, i) => (
                <section key={i} aria-label={shownPages.length > 1 ? `Page ${i + 1}` : undefined}>
                  {shownPages.length > 1 && <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-faint">Page {i + 1}</div>}
                  <div className="resume-text text-ink-2">
                    {target.source === "profile" || !target.page || target.page === i + 1 ? highlight(p, [target.quote]) : p}
                  </div>
                </section>
              ))}
          </div>
        </div>
      </dialog>
    </Ctx.Provider>
  );
}
