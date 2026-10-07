"use client";

import { useActionState } from "react";
import { FormMessage, SubmitButton } from "@/components/client";
import { Field, Input } from "@/components/ui";
import { deleteOrganization } from "@/server/auth-actions";

export function DeleteOrg({ orgName }: { orgName: string }) {
  const [state, action] = useActionState(deleteOrganization, undefined);
  return (
    <form action={action} className="space-y-3">
      <Field label={`Type “${orgName}” to confirm`}>
        <Input name="confirm" autoComplete="off" />
      </Field>
      <div className="flex items-center gap-3">
        <FormMessage state={state} />
        <SubmitButton variant="danger" className="ml-auto" pendingLabel="Deleting…">Delete workspace and all data</SubmitButton>
      </div>
    </form>
  );
}
