"use client";

import clsx from "clsx";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";

type Rect = { x: number; y: number; w: number; h: number };
// Last indicator position per nav, so a nav that re-mounts (e.g. role tabs) still slides from where it was.
const lastRect = new Map<string, Rect>();

/**
 * Moves one shared highlight to whichever child link has aria-current="page".
 * "pill" sits behind the link (sidebar); "underline" runs along the bottom (tabs).
 */
export function SlidingIndicator({
  id,
  variant,
  className,
  children,
  match = '[aria-current="page"]',
  role,
}: {
  id: string;
  variant: "pill" | "underline";
  className?: string;
  children: ReactNode;
  /** Which child is active. */
  match?: string;
  role?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [rect, setRect] = useState<Rect | null>(null);
  const [animate, setAnimate] = useState(false);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const measure = () => {
      const a = el.querySelector<HTMLElement>(match);
      if (!a) return setRect(null);
      const c = el.getBoundingClientRect();
      const r = a.getBoundingClientRect();
      const next = { x: r.left - c.left, y: r.top - c.top, w: r.width, h: r.height };
      lastRect.set(id, next);
      setRect(next);
    };
    const prev = lastRect.get(id);
    let raf = 0;
    if (prev) {
      setRect(prev);
      raf = requestAnimationFrame(() => {
        setAnimate(true);
        measure();
      });
    } else {
      measure();
      raf = requestAnimationFrame(() => setAnimate(true));
    }
    const mo = new MutationObserver(measure);
    mo.observe(el, { subtree: true, childList: true, attributes: true, attributeFilter: ["aria-current", "aria-selected", "class"] });
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      mo.disconnect();
      ro.disconnect();
    };
  }, [id, match]);

  return (
    <div ref={ref} role={role} className={clsx("relative", className)}>
      {rect && (
        <span
          aria-hidden
          className={clsx(
            "pointer-events-none absolute left-0 top-0",
            variant === "pill" ? "rounded-lg bg-brand-soft" : "h-0.5 rounded-full bg-brand",
            animate && "transition-[transform,width,height] duration-300 ease-[cubic-bezier(0.2,0.8,0.2,1)]",
          )}
          style={
            variant === "pill"
              ? { transform: `translate(${rect.x}px, ${rect.y}px)`, width: rect.w, height: rect.h }
              : { transform: `translate(${rect.x}px, ${rect.y + rect.h - 2}px)`, width: rect.w }
          }
        />
      )}
      {children}
    </div>
  );
}

/**
 * A thin brand bar at the top of the window while the next page loads after a link click.
 * It only creeps toward the end (it never claims a percentage) and finishes when the page arrives.
 */
export function NavProgress() {
  const path = usePathname();
  const search = useSearchParams();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");

  useEffect(() => {
    setState((s) => (s === "loading" ? "done" : s));
    const t = setTimeout(() => setState((s) => (s === "done" ? "idle" : s)), 450);
    return () => clearTimeout(t);
  }, [path, search]);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      // Capture phase: Next.js links cancel the native click, so a bubbling listener would never see it.
      if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || (a.target && a.target !== "_self") || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname.startsWith("/api/")) return;
      if (url.pathname === location.pathname && url.search === location.search) return; // same page / anchor
      setState("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return (
    <div
      aria-hidden
      className={clsx(
        "pointer-events-none fixed inset-x-0 top-0 z-[60] h-[2px] origin-left bg-brand",
        state === "idle" && "scale-x-0 opacity-0",
        state === "loading" && "nav-progress-loading",
        state === "done" && "scale-x-100 opacity-0 transition-[transform,opacity] duration-300 ease-out",
      )}
    />
  );
}
