import type { ReactNode } from "react";

/** Highlights each quote in `text` (whitespace- and case-insensitive). */
export function highlight(text: string, quotes: string[]): ReactNode[] {
  const patterns = quotes
    .map((q) => q.trim())
    .filter((q) => q.length >= 4)
    .map((q) => q.split(/\s+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s+"));
  if (patterns.length === 0) return [text];
  const re = new RegExp(`(${patterns.join("|")})`, "gi");
  const out: ReactNode[] = [];
  let last = 0;
  for (const m of text.matchAll(re)) {
    if (m.index === undefined || m[0].length === 0) continue;
    if (m.index > last) out.push(text.slice(last, m.index));
    out.push(
      <mark key={m.index} className="rounded-sm bg-[#fde7a8] px-0.5 text-ink">
        {m[0]}
      </mark>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}
