"use client";

import { useState } from "react";
import { ActionButton, ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { Field, Input, Select } from "@/components/ui";
import { createInvite, revokeInvite, setMemberRole } from "@/server/team-actions";

export const MEMBER_ROLE_LABEL: Record<string, string> = { admin: "Admin", recruiter: "Recruiter", hiring_manager: "Hiring manager" };

type Member = { id: string; name: string; email: string; role: string; you: boolean };
type Invite = { id: string; name: string; email: string; role: string; expiresAt: string; invitedByName: string };

/** Members and invites. Every member can see the workspace's roles and candidates (existing model). */
export function TeamCard({ members, invites, isAdmin }: { members: Member[]; invites: Invite[]; isAdmin: boolean }) {
  const [state, action, pending] = useServerForm(createInvite);
  const [copied, setCopied] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  return (
    <div className="space-y-4 text-[13px]">
      <ul className="divide-y divide-line rounded-lg border border-line">
        {members.map((m) => (
          <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2">
            <span>
              <span className="font-medium">{m.name}</span>
              {m.you && <span className="text-faint"> (you)</span>} <span className="text-muted">· {m.email}</span>
            </span>
            {isAdmin && !m.you ? (
              <Select
                aria-label={`Role for ${m.name}`}
                defaultValue={m.role}
                className="h-8 w-auto text-[12.5px]"
                onChange={async (e) => {
                  const r = await setMemberRole(m.id, e.target.value);
                  setErr(r?.error ?? null);
                }}
              >
                {Object.entries(MEMBER_ROLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            ) : (
              <span className="text-muted">{MEMBER_ROLE_LABEL[m.role] ?? m.role}</span>
            )}
          </li>
        ))}
      </ul>
      {err && <p className="text-[12.5px] text-danger">{err}</p>}
      <p className="text-[12px] text-muted">
        Hiring managers and admins can record a team decision in any interview debrief; recruiters can for interview plans they own. Everyone in the workspace can see roles and candidates.
      </p>

      {isAdmin && (
        <>
          {invites.length > 0 && (
            <div>
              <div className="mb-1 font-medium">Pending invites</div>
              <ul className="space-y-1">
                {invites.map((i) => (
                  <li key={i.id} className="flex flex-wrap items-center gap-2">
                    {i.name} <span className="text-muted">· {i.email} · {MEMBER_ROLE_LABEL[i.role]} · expires {new Date(i.expiresAt).toLocaleDateString()}</span>
                    <ActionButton action={() => revokeInvite(i.id)} variant="ghost" successMessage="Invite revoked">
                      Revoke
                    </ActionButton>
                  </li>
                ))}
              </ul>
            </div>
          )}
          <ActionForm action={action} pending={pending} className="grid gap-2 sm:grid-cols-[1fr_1.2fr_auto_auto] sm:items-end">
            <Field label="Name">
              <Input name="name" required maxLength={120} />
            </Field>
            <Field label="Email">
              <Input name="email" type="email" required maxLength={200} />
            </Field>
            <Field label="Role">
              <Select name="role" defaultValue="hiring_manager" className="w-auto">
                {Object.entries(MEMBER_ROLE_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton pendingLabel="Creating…">Create invite link</SubmitButton>
          </ActionForm>
          <FormMessage state={state?.link ? undefined : state} />
          {state?.link && (
            <div className="space-y-1 rounded-lg border border-line bg-sunken/60 p-3">
              <p>{state.message}</p>
              <div className="flex gap-2">
                <Input readOnly value={state.link} className="h-8 font-mono text-[12px]" aria-label="Invite link" onFocus={(e) => e.currentTarget.select()} />
                <button
                  type="button"
                  className="h-8 rounded-lg bg-ink px-3 text-[12.5px] font-medium text-white"
                  onClick={async () => {
                    await navigator.clipboard.writeText(state.link!).then(() => setCopied(true)).catch(() => setCopied(false));
                  }}
                >
                  {copied ? "Copied" : "Copy"}
                </button>
              </div>
              <p className="text-[11.5px] text-faint">Talyn did not email this link. It won&apos;t be shown again.</p>
            </div>
          )}
        </>
      )}
    </div>
  );
}
