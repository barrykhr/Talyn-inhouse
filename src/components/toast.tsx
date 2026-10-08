"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";

// Quiet confirmations for meaningful actions (saved, moved, recorded), optionally with Undo.
// Announced politely to screen readers; never used for urgency.

type Toast = { id: number; message: string; action?: { label: string; run: () => void | Promise<void> } };
const ToastContext = createContext<(t: Omit<Toast, "id">) => void>(() => {});

export function useToast() {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const next = useRef(1);
  const push = useCallback((t: Omit<Toast, "id">) => {
    const id = next.current++;
    setToasts((all) => [...all.slice(-2), { ...t, id }]);
  }, []);
  const dismiss = (id: number) => setToasts((all) => all.filter((t) => t.id !== id));
  return (
    <ToastContext.Provider value={push}>
      {children}
      <div role="status" aria-live="polite" className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4">
        {toasts.map((t) => (
          <ToastItem key={t.id} toast={t} onDone={() => dismiss(t.id)} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({ toast, onDone }: { toast: Toast; onDone: () => void }) {
  const [hover, setHover] = useState(false);
  useEffect(() => {
    if (hover) return;
    const t = setTimeout(onDone, toast.action ? 6000 : 3200);
    return () => clearTimeout(t);
  }, [hover, onDone, toast.action]);
  return (
    <div
      onMouseEnter={() => setHover(true)}
      onMouseLeave={() => setHover(false)}
      className="motion-drawer pointer-events-auto flex items-center gap-3 rounded-xl bg-ink px-4 py-2.5 text-[13px] text-white shadow-lg"
    >
      <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden className="shrink-0 text-[#8fd5ad]">
        <path d="M3 7.3l2.6 2.5L11 4.3" stroke="currentColor" strokeWidth="1.8" fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <span>{toast.message}</span>
      {toast.action && (
        <button
          type="button"
          className="rounded-md px-1.5 py-0.5 font-medium text-[#f6b89c] underline-offset-2 hover:underline"
          onClick={async () => {
            onDone();
            await toast.action!.run();
          }}
        >
          {toast.action.label}
        </button>
      )}
    </div>
  );
}
