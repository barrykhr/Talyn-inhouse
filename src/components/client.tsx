"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { createContext, useContext, useState, type ReactNode } from "react";
import { useFormStatus } from "react-dom";
import { useToast } from "./toast";
import { buttonClass } from "./ui";

const FormPending = createContext(false);

/**
 * Like useTransition's [pending, start] but WITHOUT a React transition. Server actions
 * awaited inside a transition can stall Next's router queue (dropped refreshes/navigation),
 * so client code that calls server actions uses this instead.
 */
export function usePendingTask() {
  const [pending, setPending] = useState(false);
  const run = (task: () => Promise<unknown>) => {
    setPending(true);
    void task().finally(() => setPending(false));
  };
  return [pending, run] as const;
}

type FormResult = { ok?: boolean; error?: string; message?: string; redirectTo?: string } | undefined;

/**
 * Drop-in for useActionState for forms rendered with <ActionForm>. It calls the server
 * action directly (not inside a transition), keeps the result, and on `redirectTo` does a
 * full page load once the action has settled. Returns [state, submit, pending].
 */
export function useServerForm<S extends FormResult>(serverAction: (prev: S, fd: FormData) => Promise<S>) {
  const [state, setState] = useState<S>(undefined as S);
  const [pending, setPending] = useState(false);
  const router = useRouter();
  const submit = async (fd: FormData) => {
    if (pending) return;
    setPending(true);
    let result: S;
    try {
      result = await serverAction(state, fd);
    } catch {
      result = { error: "Something went wrong. Your entries are kept — please try again." } as S;
    }
    if (result?.redirectTo) {
      // Full page load: client-side router.push after a server action is occasionally
      // dropped by Next's router queue, and these steps change pages anyway.
      window.location.assign(result.redirectTo);
      return; // keep the button busy until the new page loads
    }
    setState(result);
    setPending(false);
    router.refresh();
  };
  return [state, submit, pending] as const;
}

/**
 * A form that submits WITHOUT React's automatic form reset, so recruiter-entered values
 * (including chosen files) survive validation, parsing or AI failures. Use with useServerForm.
 */
export function ActionForm({
  action,
  pending = false,
  children,
  className,
}: {
  action: (fd: FormData) => void;
  pending?: boolean;
  children: ReactNode;
  className?: string;
}) {
  return (
    <FormPending.Provider value={pending}>
      <form
        method="post" // if submitted before hydration, never put field values in the URL
        className={className}
        onSubmit={(e) => {
          e.preventDefault();
          action(new FormData(e.currentTarget));
        }}
      >
        {children}
      </form>
    </FormPending.Provider>
  );
}

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
  const status = useFormStatus();
  const pending = useContext(FormPending) || status.pending;
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
  successMessage,
}: {
  action: () => Promise<unknown>;
  /** Shown as a quiet confirmation toast when the action succeeds. */
  successMessage?: string;
  children: ReactNode;
  confirm?: string;
  variant?: "primary" | "secondary" | "ghost" | "danger" | "signal";
  size?: "sm" | "md";
  className?: string;
  pendingLabel?: string;
  title?: string;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();
  const toast = useToast();
  const run = async () => {
    if (confirm && !window.confirm(confirm)) return;
    setError(null);
    setPending(true);
    let res: { error?: string; redirectTo?: string } | undefined;
    try {
      res = (await action()) as typeof res;
    } catch {
      res = { error: "Something went wrong. Please try again." };
    }
    if (res && typeof res === "object" && res.redirectTo) return window.location.assign(res.redirectTo);
    setPending(false);
    if (res && typeof res === "object" && res.error) setError(res.error);
    else {
      router.refresh();
      if (successMessage) toast({ message: successMessage });
    }
  };
  return (
    <span className="inline-flex flex-col items-start">
      <button
        type="button"
        title={title}
        disabled={pending}
        aria-busy={pending}
        className={buttonClass(variant, size, className)}
        onClick={run}
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
