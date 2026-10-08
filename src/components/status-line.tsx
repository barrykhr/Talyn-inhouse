import clsx from "clsx";
import Link from "next/link";

export type StatusItem = { tone: "attention" | "ai" | "ok" | "neutral"; text: string; href?: string; action?: string };

/** One calm line that answers: what's happening, what needs review, what can I do next. */
export function StatusLine({ items }: { items: StatusItem[] }) {
  if (!items.length) return null;
  return (
    <div className="mb-5 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-line bg-surface px-4 py-2.5 text-[13px]" aria-label="Status">
      {items.map((it, i) => (
        <span key={i} className="inline-flex items-center gap-2">
          <span
            aria-hidden
            className={clsx(
              "h-1.5 w-1.5 rounded-full",
              it.tone === "attention" && "bg-warn",
              it.tone === "ai" && "bg-signal",
              it.tone === "ok" && "bg-ok",
              it.tone === "neutral" && "bg-faint",
            )}
          />
          <span className="text-ink-2">{it.text}</span>
          {it.href && it.action && (
            <Link href={it.href} className="font-medium text-ink underline-offset-2 hover:underline">
              {it.action}
            </Link>
          )}
        </span>
      ))}
    </div>
  );
}
