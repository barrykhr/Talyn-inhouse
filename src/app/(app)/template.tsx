"use client";

import { usePathname } from "next/navigation";
import { useLayoutEffect, useRef } from "react";

// Re-mounts on every navigation inside the app shell. The direction follows where you went:
// deeper (roles → a role → a candidate) arrives from the right, back up arrives from the left,
// and a move at the same level rises in. Set before paint, once per path, so a refresh of the
// same page never restarts the animation. Disabled under prefers-reduced-motion.
let lastPath: string | null = null;

const depth = (p: string) => (p === "/home" || p === "/inbox" ? 0 : p.split("/").filter(Boolean).length);

function directionFor(from: string | null, to: string): "forward" | "back" | "lateral" {
  if (!from || from === to) return "lateral";
  const a = depth(from), b = depth(to);
  return b > a ? "forward" : b < a ? "back" : "lateral";
}

export default function AppTemplate({ children }: { children: React.ReactNode }) {
  const path = usePathname();
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (ref.current) ref.current.dataset.dir = directionFor(lastPath, path);
    lastPath = path;
  }, [path]);
  return (
    <div ref={ref} className="motion-page">
      {children}
    </div>
  );
}
