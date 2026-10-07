"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState, useTransition, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { buttonClass } from "./ui";

export function SubmitButton({
  children,
  pendingLabel,
  variant = "primary",
  size = "md",
  className,
}: {
  children: ReactNode;
  pendingLabel?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "signal";
  size?: "sm" | "md";
  className?: string;
}) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending} aria-busy={pending} className={buttonClass(variant, size, className)}>
      {pending ? <Spinner /> : null}
      {pending && pendingLabel ? pendingLabel : children}
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={clsx("h-3.5 w-3.5 animate-spin", className)} viewBox="0 0 16 16" fill="none" aria-hidden>
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeOpacity="0.25" strokeWidth="2" />
      <path d="M14 8a6 6 0 00-6-6" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
}

/** Runs a server action from a button, with an optional confirmation and pending state. */
export function ActionButton({
  action,
  children,
  confirm,
  variant = "secondary",
  size = "sm",
  className,
  pendingLabel,
  title,
}: {
  action: () => Promise<unknown>;
  children: ReactNode;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "signal";
  size?: "sm" | "md";
  className?: string;
  pendingLabel?: string;
  title?: string;
}) {
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        title={title}
        disabled={pending}
        aria-busy={pending}
        className={buttonClass(variant, size, className)}
        onClick={() => {
          if (confirm && !window.confirm(confirm)) return;
          setError(null);
          start(async () => {
            try {
              const res = (await action()) as { error?: string } | undefined;
              if (res && typeof res === "object" && res.error) setError(res.error);
              router.refresh();
            } catch (e) {
              // Redirects thrown by server actions are handled by Next; anything else is shown.
              if (e && typeof e === "object" && "digest" in e && String((e as { digest: unknown }).digest).startsWith("NEXT_")) throw e;
              setError("Something went wrong. Please try again.");
            }
          });
        }}
      >
        {pending && <Spinner />}
        {pending && pendingLabel ? pendingLabel : children}
      </button>
      {error && <span className="mt-1 text-[12px] text-danger">{error}</span>}
    </span>
  );
}

export function FormMessage({ state }: { state: { error?: string; message?: string } | undefined }) {
  if (!state) return null;
  if (state.error) return <p role="alert" className="text-[13px] text-danger">{state.error}</p>;
  if (state.message) return <p className="text-[13px] text-ok">{state.message}</p>;
  return null;
}
