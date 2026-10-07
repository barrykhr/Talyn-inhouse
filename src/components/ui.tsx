import clsx from "clsx";
import Link from "next/link";
import type { ComponentProps, ReactNode } from "react";

type ButtonVariant = "primary" | "secondary" | "ghost" | "danger" | "signal";
const buttonBase =
  "inline-flex items-center justify-center gap-1.5 rounded-lg font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap";
const buttonVariants: Record<ButtonVariant, string> = {
  primary: "bg-ink text-white hover:bg-ink-2",
  secondary: "bg-surface text-ink border border-line-strong hover:bg-sunken",
  ghost: "text-ink-2 hover:bg-sunken",
  danger: "bg-surface text-danger border border-line-strong hover:bg-danger-soft",
  signal: "bg-signal text-white hover:brightness-95",
};
const buttonSizes = { sm: "h-7 px-2.5 text-[13px]", md: "h-9 px-3.5 text-sm" };

export function buttonClass(variant: ButtonVariant = "secondary", size: "sm" | "md" = "md", extra?: string) {
  return clsx(buttonBase, buttonVariants[variant], buttonSizes[size], extra);
}

export function Button({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <button className={buttonClass(variant, size, className)} {...props} />;
}

export function LinkButton({
  variant = "secondary",
  size = "md",
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: "sm" | "md" }) {
  return <Link className={buttonClass(variant, size, className)} {...props} />;
}

export function Card({ className, ...props }: ComponentProps<"div">) {
  return <div className={clsx("rounded-[var(--radius-card)] border border-line bg-surface", className)} {...props} />;
}

export function SectionTitle({ children, action, hint }: { children: ReactNode; action?: ReactNode; hint?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <div>
        <h2 className="text-[15px] font-semibold tracking-tight">{children}</h2>
        {hint && <p className="mt-0.5 text-[13px] text-muted">{hint}</p>}
      </div>
      {action}
    </div>
  );
}

export function PageHeader({ title, eyebrow, meta, actions }: { title: ReactNode; eyebrow?: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        {eyebrow && <div className="mb-1 text-[13px] text-muted">{eyebrow}</div>}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {meta && <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px] text-muted">{meta}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </header>
  );
}

type Tone = "neutral" | "ok" | "warn" | "gap" | "signal" | "danger" | "ink";
const tones: Record<Tone, string> = {
  neutral: "bg-sunken text-ink-2",
  ok: "bg-ok-soft text-ok",
  warn: "bg-warn-soft text-warn",
  gap: "bg-gap-soft text-gap",
  signal: "bg-signal-soft text-signal",
  danger: "bg-danger-soft text-danger",
  ink: "bg-ink text-white",
};
export function Badge({ tone = "neutral", children, className, title }: { tone?: Tone; children: ReactNode; className?: string; title?: string }) {
  return (
    <span title={title} className={clsx("inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[12px] font-medium leading-4", tones[tone], className)}>
      {children}
    </span>
  );
}

export function EmptyState({ title, body, action, className }: { title: string; body?: ReactNode; action?: ReactNode; className?: string }) {
  return (
    <div className={clsx("rounded-[var(--radius-card)] border border-dashed border-line-strong px-6 py-10 text-center", className)}>
      <p className="font-medium">{title}</p>
      {body && <p className="mx-auto mt-1 max-w-md text-[13px] text-muted">{body}</p>}
      {action && <div className="mt-4 flex justify-center gap-2">{action}</div>}
    </div>
  );
}

export function Notice({ tone = "neutral", children, className }: { tone?: "neutral" | "warn" | "danger" | "ok" | "signal"; children: ReactNode; className?: string }) {
  const map = {
    neutral: "border-line bg-sunken text-ink-2",
    warn: "border-[#f0dcae] bg-warn-soft text-warn",
    danger: "border-[#f5c6c1] bg-danger-soft text-danger",
    ok: "border-[#c3e2cf] bg-ok-soft text-ok",
    signal: "border-[#f3cdbb] bg-signal-soft text-[#9a3a12]",
  };
  return <div className={clsx("rounded-lg border px-3 py-2 text-[13px]", map[tone], className)}>{children}</div>;
}

const fieldBase =
  "w-full rounded-lg border border-line-strong bg-surface px-3 text-sm text-ink placeholder:text-faint focus:border-ink focus:outline-none";

export function Input({ className, ...props }: ComponentProps<"input">) {
  return <input className={clsx(fieldBase, "h-9", className)} {...props} />;
}
export function Textarea({ className, ...props }: ComponentProps<"textarea">) {
  return <textarea className={clsx(fieldBase, "py-2 leading-relaxed", className)} {...props} />;
}
export function Select({ className, ...props }: ComponentProps<"select">) {
  return <select className={clsx(fieldBase, "h-9 pr-8", className)} {...props} />;
}

export function Field({ label, hint, children, className }: { label: string; hint?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <label className={clsx("block", className)}>
      <span className="mb-1 block text-[13px] font-medium text-ink-2">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[12px] text-muted">{hint}</span>}
    </label>
  );
}

/** Marks content produced by a model, so provenance is always visible. */
export function AiMark({ label = "AI" }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-signal-soft px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-signal">
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M5 0l1.2 3.8L10 5 6.2 6.2 5 10 3.8 6.2 0 5l3.8-1.2z" fill="currentColor" />
      </svg>
      {label}
    </span>
  );
}

export function Dot({ className }: { className?: string }) {
  return <span className={clsx("inline-block h-1.5 w-1.5 rounded-full", className)} />;
}

export function formatDate(d: Date | string) {
  return new Date(d).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}
export function formatDateTime(d: Date | string) {
  return new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}
