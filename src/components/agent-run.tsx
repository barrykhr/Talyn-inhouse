import clsx from "clsx";
import Link from "next/link";
import type { ReactNode } from "react";

export type AgentStepState = "done" | "active" | "blocked" | "pending" | "skipped";
export type AgentStep = {
  key: string;
  label: string;
  state: AgentStepState;
  /** What happened, or why it's blocked — facts only. */
  detail?: ReactNode;
  /** Sources consulted or evidence produced in this step, linked where possible. */
  sources?: { label: string; href?: string; note?: string }[];
  /** Link to the place where a person can unblock or edit this step. */
  fix?: { label: string; href: string };
};

const STATE: Record<AgentStepState, { label: string; mark: string; cls: string }> = {
  done: { label: "Done", mark: "✓", cls: "border-ok/40 bg-ok-soft text-ok" },
  active: { label: "Waiting on you", mark: "•", cls: "border-brand/50 bg-brand-soft text-brand" },
  blocked: { label: "Blocked", mark: "!", cls: "border-danger/40 bg-danger-soft text-danger" },
  pending: { label: "Not started", mark: "", cls: "border-line-strong bg-surface text-faint" },
  skipped: { label: "Skipped", mark: "–", cls: "border-line bg-sunken text-faint" },
};

/**
 * One visible run of Talyn's assistant inside a workflow: the steps it follows, which are done,
 * which are waiting on a person and which are blocked, with sources and links to fix them.
 * Every state is derived from stored records — nothing here animates to suggest live work.
 */
export function AgentRun({
  title,
  summary,
  steps,
  controls,
  footer,
  className,
}: {
  title: ReactNode;
  summary?: ReactNode;
  steps: AgentStep[];
  controls?: ReactNode;
  footer?: ReactNode;
  className?: string;
}) {
  const done = steps.filter((s) => s.state === "done").length;
  return (
    <section className={clsx("rounded-xl border border-line bg-surface", className)} aria-label="Assistant steps">
      <header className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-4 py-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[13.5px] font-semibold">
            <span className="inline-flex items-center gap-1 rounded-md bg-brand-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-brand">Assistant</span>
            {title}
          </div>
          {summary && <p className="mt-0.5 text-[12.5px] text-muted">{summary}</p>}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-[12px] tabular-nums text-faint">
            {done} of {steps.length} steps done
          </span>
          {controls}
        </div>
      </header>
      <ol className="px-4 py-3">
        {steps.map((s, i) => {
          const st = STATE[s.state];
          return (
            <li key={s.key} className="motion-step relative flex gap-3 pb-3 last:pb-0" style={{ animationDelay: `${Math.min(i, 6) * 40}ms` }}>
              {i < steps.length - 1 && <span aria-hidden className="absolute left-[11px] top-6 h-[calc(100%-18px)] w-px bg-line" />}
              <span aria-hidden className={clsx("relative z-[1] mt-0.5 flex h-[23px] w-[23px] shrink-0 items-center justify-center rounded-full border text-[11px] font-bold", st.cls)}>
                {st.mark || i + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                  <span className={clsx("text-[13.5px] font-medium", s.state === "pending" || s.state === "skipped" ? "text-muted" : "text-ink")}>{s.label}</span>
                  <span className={clsx("text-[11.5px] font-medium", s.state === "blocked" ? "text-danger" : s.state === "active" ? "text-brand" : "text-faint")}>{st.label}</span>
                </div>
                {s.detail && <div className="mt-0.5 text-[12.5px] text-ink-2">{s.detail}</div>}
                {!!s.sources?.length && (
                  <ul className="mt-1 flex flex-wrap gap-1.5 text-[12px]">
                    {s.sources.map((src, j) => (
                      <li key={j} className="rounded-md border border-line px-1.5 py-0.5 text-muted">
                        {src.href ? (
                          <Link href={src.href} className="hover:text-ink hover:underline">
                            {src.label}
                          </Link>
                        ) : (
                          src.label
                        )}
                        {src.note && <span className="text-faint"> · {src.note}</span>}
                      </li>
                    ))}
                  </ul>
                )}
                {s.fix && (
                  <Link href={s.fix.href} className="mt-1 inline-block text-[12.5px] font-medium text-brand underline-offset-2 hover:underline">
                    {s.fix.label} →
                  </Link>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {footer && <footer className="border-t border-line px-4 py-2.5 text-[12px] text-muted">{footer}</footer>}
    </section>
  );
}

/** Marks who produced something: the assistant's suggestion vs. a person's decision. */
export function Provenance({ kind, who, at, className }: { kind: "ai" | "human" | "system"; who?: string | null; at?: Date | string | null; className?: string }) {
  const when = at ? new Date(at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : null;
  const text = kind === "ai" ? "AI suggestion" : kind === "human" ? `Decision${who ? ` by ${who}` : ""}` : "Recorded by Talyn";
  return (
    <span
      className={clsx(
        "inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[11px] font-semibold leading-4",
        kind === "ai" ? "border border-dashed border-brand/50 text-brand" : kind === "human" ? "bg-ink text-white" : "bg-sunken text-muted",
        className,
      )}
      title={kind === "ai" ? "Produced by the assistant for a person to review. Not a decision." : undefined}
    >
      {text}
      {when && <span className="font-normal opacity-80">· {when}</span>}
    </span>
  );
}
