"use client";

import { ActionButton } from "@/components/client";
import { dismissOutbox, linkAts, retryOutbox, syncAtsNow, unlinkAts } from "@/server/ats-actions";
import { sendDueNow, sendTestEmail } from "@/server/outreach-actions";

export function EmailButtons() {
  return (
    <div className="flex flex-wrap gap-2">
      <ActionButton action={sendTestEmail} pendingLabel="Sending…" successMessage="Test email sent to your address">
        Send me a test email
      </ActionButton>
      <ActionButton action={sendDueNow} pendingLabel="Sending…" successMessage="Due messages processed">
        Send due messages now
      </ActionButton>
    </div>
  );
}

export function AtsButtons({ linked }: { linked: boolean }) {
  return linked ? (
    <div className="flex flex-wrap gap-2">
      <ActionButton action={syncAtsNow} variant="primary" pendingLabel="Syncing…" successMessage="Sync finished — see history below">
        Sync now
      </ActionButton>
      <ActionButton action={unlinkAts} confirm="Stop syncing this workspace with the ATS? Records already in Talyn are kept; unsent stage changes are cancelled." pendingLabel="Unlinking…">
        Unlink workspace
      </ActionButton>
    </div>
  ) : (
    <ActionButton action={linkAts} variant="primary" pendingLabel="Linking…" successMessage="Workspace linked to the ATS">
      Link this workspace
    </ActionButton>
  );
}

export function OutboxButtons({ id }: { id: string }) {
  return (
    <span className="flex gap-1">
      <ActionButton action={() => retryOutbox(id)} pendingLabel="Retrying…">
        Retry
      </ActionButton>
      <ActionButton action={() => dismissOutbox(id)} variant="ghost" confirm="Dismiss? Update the ATS manually.">
        Dismiss
      </ActionButton>
    </span>
  );
}
