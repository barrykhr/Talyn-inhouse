"use client";

import { useEffect } from "react";
import { ActionForm, SubmitButton, useServerForm } from "@/components/client";
import { useToast } from "@/components/toast";
import { createInfoRequest } from "@/server/task-actions";

/** Turns flagged claims into an information request in the recruiter's queue. Nothing is sent to the candidate. */
export function ClarifyButton({ applicationId, questions }: { applicationId: string; questions: string[] }) {
  const [state, action, pending] = useServerForm(createInfoRequest.bind(null, applicationId));
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) toast({ message: "Clarification request added to your queue" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  if (state?.ok) return <p className="text-[12px] text-muted">Request added to your queue.</p>;
  return (
    <ActionForm action={action} pending={pending}>
      <input type="hidden" name="title" value="Clarify profile details" />
      <input type="hidden" name="questions" value={questions.join("\n")} />
      <SubmitButton size="sm" variant="secondary" pendingLabel="Adding…">
        Request clarification
      </SubmitButton>
      {state?.error && <p className="mt-1 text-[12px] text-danger">{state.error}</p>}
    </ActionForm>
  );
}
