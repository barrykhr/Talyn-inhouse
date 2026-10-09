"use client";

import { useActionState, useState } from "react";
import { FormMessage, SubmitButton } from "@/components/client";
import { Button, Field, Input } from "@/components/ui";
import { acceptInvite, acceptInviteNewAccount } from "@/server/team-actions";

export function AcceptExisting({ token }: { token: string }) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <div className="space-y-2">
      <Button
        variant="primary"
        className="w-full"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          const r = await acceptInvite(token);
          setBusy(false);
          if (r?.error) setError(r.error);
        }}
      >
        {busy ? "Joining…" : "Join workspace"}
      </Button>
      {error && <p className="text-[12.5px] text-danger">{error}</p>}
    </div>
  );
}

export function AcceptNew({ token, name, email }: { token: string; name: string; email: string }) {
  const [state, action] = useActionState(acceptInviteNewAccount.bind(null, token), undefined);
  return (
    <form action={action} className="space-y-3">
      <Field label="Email">
        <Input value={email} disabled readOnly />
      </Field>
      <Field label="Your name">
        <Input name="name" defaultValue={name} required maxLength={120} autoComplete="name" />
      </Field>
      <Field label="Choose a password" hint="At least 10 characters.">
        <Input name="password" type="password" minLength={10} required autoComplete="new-password" />
      </Field>
      <FormMessage state={state} />
      <SubmitButton className="w-full" pendingLabel="Creating account…">
        Create account and join
      </SubmitButton>
    </form>
  );
}
