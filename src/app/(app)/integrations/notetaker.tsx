"use client";

import { useState } from "react";
import { ActionButton, Spinner } from "@/components/client";
import { buttonClass, Input } from "@/components/ui";
import { createNotetakerToken, revokeNotetakerToken } from "@/server/call-actions";

/** Admin: create the workspace's notetaker token. It is shown once; Talyn keeps only its hash. */
export function NotetakerConnect({ connected, defaultName }: { connected: boolean; defaultName: string }) {
  const [name, setName] = useState(defaultName);
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const create = async () => {
    if (connected && !window.confirm("Create a new token? The current one stops working.")) return;
    setBusy(true);
    setErr(null);
    const r = await createNotetakerToken(name).catch(() => ({ error: "Couldn't create a token. Try again." }));
    setBusy(false);
    if ("error" in r) setErr(r.error);
    else setToken(r.token);
  };
  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-[12.5px]">
          <span className="mb-1 block font-medium">Notetaker name</span>
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder="e.g. Fireflies" className="w-56" />
        </label>
        <button type="button" onClick={create} disabled={busy} className={buttonClass(connected ? "secondary" : "primary", "sm")}>
          {busy && <Spinner />} {connected ? "Replace token" : "Create token"}
        </button>
        {connected && (
          <ActionButton action={revokeNotetakerToken} variant="ghost" confirm="Disconnect the notetaker? Calls already received are kept.">
            Disconnect
          </ActionButton>
        )}
      </div>
      {err && <p className="text-[12.5px] text-danger">{err}</p>}
      {token && (
        <div className="motion-fade rounded-lg border border-warn bg-warn-soft p-3 text-[12.5px]">
          <p className="font-medium">Copy this token now. It won&apos;t be shown again.</p>
          <code className="mt-1 block break-all rounded bg-surface px-2 py-1 font-mono text-[12px]">{token}</code>
          <p className="mt-1 text-ink-2">Send it as <code className="font-mono">Authorization: Bearer &lt;token&gt;</code> from your notetaker&apos;s webhook, Zapier or Make.</p>
        </div>
      )}
    </div>
  );
}
