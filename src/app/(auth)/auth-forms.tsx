"use client";

import Link from "next/link";
import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/client";
import { Card, Field, Input } from "@/components/ui";
import { login, signup } from "@/server/auth-actions";

export function LoginForm() {
  const [state, action] = useActionState(login, undefined);
  return (
    <Card className="p-6">
      <h1 className="mb-5 text-lg font-semibold tracking-tight">Sign in</h1>
      <form action={action} className="space-y-4">
        <Field label="Work email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password">
          <Input name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton className="w-full" pendingLabel="Signing in…">Sign in</SubmitButton>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted">
        New to Talyn? <Link href="/signup" className="font-medium text-ink underline-offset-2 hover:underline">Create a workspace</Link>
      </p>
    </Card>
  );
}

export function SignupForm() {
  const [state, action] = useActionState(signup, undefined);
  return (
    <Card className="p-6">
      <h1 className="text-lg font-semibold tracking-tight">Create your workspace</h1>
      <p className="mb-5 mt-1 text-[13px] text-muted">Your company&apos;s roles and candidates stay private to your workspace.</p>
      <form action={action} className="space-y-4">
        <Field label="Your name">
          <Input name="name" autoComplete="name" required />
        </Field>
        <Field label="Company">
          <Input name="orgName" autoComplete="organization" required />
        </Field>
        <Field label="Work email">
          <Input name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" hint="At least 10 characters.">
          <Input name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <FormMessage state={state} />
        <SubmitButton className="w-full" pendingLabel="Creating…">Create workspace</SubmitButton>
      </form>
      <p className="mt-5 text-center text-[13px] text-muted">
        Already have an account? <Link href="/login" className="font-medium text-ink underline-offset-2 hover:underline">Sign in</Link>
      </p>
    </Card>
  );
}
