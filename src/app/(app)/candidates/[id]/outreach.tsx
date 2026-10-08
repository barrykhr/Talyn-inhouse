"use client";

import clsx from "clsx";
import { useEffect, useState } from "react";
import { ActionButton, ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { useToast } from "@/components/toast";
import { AiMark, Button, Card, EmptyState, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import {
  activateSequence,
  approveMessage,
  draftSequence,
  pauseSequence,
  recordOutcome,
  recordSent,
  saveTemplate,
  stopSequence,
  updateMessage,
} from "@/server/outreach-actions";

export type OutreachMessageView = {
  id: string;
  step: number;
  delayDays: number;
  subject: string;
  body: string;
  edited: boolean;
  personalization: { key: string; label: string; value: string; source: string }[];
  generator: string;
  status: string;
  approvedByName: string | null;
  dueAt: string | null;
  sentAt: string | null;
  sentVia: string | null;
};
export type OutreachView = {
  applicationId: string;
  email: string | null;
  emailOrigin: string | null;
  optedOut: boolean;
  aiConfigured: boolean;
  sendingHint: string;
  templates: { id: string; name: string }[];
  sequence: null | {
    id: string;
    status: string;
    stopReason: string | null;
    activatedByName: string | null;
    messages: OutreachMessageView[];
    events: { id: string; type: string; actorName: string; providerConfirmed: boolean; note: string | null; createdAt: string }[];
  };
};

const STATUS_LABEL: Record<string, string> = {
  draft: "Draft — not sent",
  active: "Active",
  paused: "Paused",
  stopped: "Stopped",
  completed: "All steps sent",
};
const fmt = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function OutreachPanel({ v }: { v: OutreachView }) {
  const seq = v.sequence;
  const live = seq && ["draft", "active", "paused"].includes(seq.status);
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[13px]">
        <span>
          <span className="text-muted">To:</span>{" "}
          {v.email ? (
            <>
              {v.email} {v.emailOrigin && <span className="text-[12px] text-faint">· {v.emailOrigin}</span>}
            </>
          ) : (
            <span className="text-warn">No email on file — add one in Edit profile. Talyn never guesses contact details.</span>
          )}
        </span>
      </div>
      {v.optedOut && <Notice tone="danger">This candidate opted out of contact. Outreach is blocked.</Notice>}
      <p className="text-[12px] text-muted">{v.sendingHint}</p>

      {!live && !v.optedOut && <Composer v={v} hasHistory={!!seq} />}
      {seq && <SequenceCard v={v} seq={seq} />}
    </div>
  );
}

function Composer({ v, hasHistory }: { v: OutreachView; hasHistory: boolean }) {
  const [state, action, pending] = useServerForm(draftSequence.bind(null, v.applicationId));
  const [steps, setSteps] = useState(2);
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) toast({ message: state.message ?? "Draft ready" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Card className="p-4">
      <div className="mb-1 font-medium">{hasHistory ? "Start a new sequence" : "Draft outreach"}</div>
      <p className="mb-3 text-[12.5px] text-muted">
        Talyn drafts each step from the approved role and recruiter-confirmed facts only, and shows which facts it used. You edit and approve every message; nothing is sent until you activate.
      </p>
      <ActionForm action={action} pending={pending} className="flex flex-wrap items-end gap-3">
        <Field label="Steps">
          <Select name="steps" value={steps} onChange={(e) => setSteps(Number(e.target.value))} className="w-auto">
            <option value={1}>1 message</option>
            <option value={2}>2 (with follow-up)</option>
            <option value={3}>3 (two follow-ups)</option>
          </Select>
        </Field>
        {steps >= 2 && (
          <Field label="Follow-up after (days)">
            <Input name="delay2" type="number" min={1} max={30} defaultValue={4} className="w-24" />
          </Field>
        )}
        {steps >= 3 && (
          <Field label="Second follow-up after">
            <Input name="delay3" type="number" min={1} max={30} defaultValue={7} className="w-24" />
          </Field>
        )}
        {v.templates.length > 0 && (
          <Field label="Start from template">
            <Select name="templateId" defaultValue="" className="w-auto">
              <option value="">{v.aiConfigured ? "AI draft" : "Plain draft"}</option>
              {v.templates.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
        )}
        <SubmitButton variant={v.aiConfigured ? "signal" : "secondary"} pendingLabel="Drafting…">
          Draft messages
        </SubmitButton>
        <FormMessage state={state?.ok ? undefined : state} />
      </ActionForm>
    </Card>
  );
}

function SequenceCard({ v, seq }: { v: OutreachView; seq: NonNullable<OutreachView["sequence"]> }) {
  const allApproved = seq.messages.every((m) => m.status !== "draft");
  const canEdit = ["draft", "paused"].includes(seq.status);
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#fbfaf8] px-4 py-3">
        <span className="font-medium">Sequence</span>
        <span className={clsx("rounded-md px-1.5 py-0.5 text-[12px] font-medium", seq.status === "active" ? "bg-ok-soft text-ok" : seq.status === "paused" ? "bg-warn-soft text-warn" : "bg-sunken text-ink-2")}>
          {STATUS_LABEL[seq.status] ?? seq.status}
          {seq.stopReason && seq.status !== "active" ? ` · ${seq.stopReason.replace("_", " ")}` : ""}
        </span>
        <span className="ml-auto flex flex-wrap gap-1.5">
          {(seq.status === "draft" || seq.status === "paused") && (
            <ActionButton
              action={() => activateSequence(seq.id)}
              variant="primary"
              confirm={`${seq.status === "paused" ? "Resume" : "Activate"} this ${seq.messages.length}-step sequence? Approved messages become due for sending; follow-ups stop if the candidate replies, opts out or bounces.`}
              successMessage={seq.status === "paused" ? "Sequence resumed" : "Sequence activated"}
            >
              {seq.status === "paused" ? "Resume" : allApproved ? "Activate" : "Activate (approve all first)"}
            </ActionButton>
          )}
          {seq.status === "active" && (
            <ActionButton action={() => pauseSequence(seq.id)} successMessage="Sequence paused">
              Pause
            </ActionButton>
          )}
          {["draft", "active", "paused"].includes(seq.status) && (
            <ActionButton action={() => stopSequence(seq.id)} variant="ghost" confirm="Stop this sequence? Unsent steps are cancelled." successMessage="Sequence stopped">
              Stop
            </ActionButton>
          )}
        </span>
      </div>

      <div className="divide-y divide-line">
        {seq.messages.map((m) => (
          <MessageRow key={m.id} m={m} seqStatus={seq.status} canEdit={canEdit && !m.sentAt} email={v.email} />
        ))}
      </div>

      {(seq.status === "active" || seq.status === "paused" || seq.status === "completed") && seq.messages.some((m) => m.sentAt) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-[12.5px]">
          <span className="text-muted">Record what happened (stops or pauses follow-ups):</span>
          <ActionButton action={() => recordOutcome(seq.id, "replied")} successMessage="Reply recorded — follow-ups stopped and a task added">
            Candidate replied
          </ActionButton>
          <ActionButton action={() => recordOutcome(seq.id, "bounced")} variant="ghost" successMessage="Bounce recorded — sequence paused">
            Bounced
          </ActionButton>
          <ActionButton
            action={() => recordOutcome(seq.id, "opted_out")}
            variant="ghost"
            confirm="Record that the candidate opted out? All outreach to them will be blocked."
            successMessage="Opt-out recorded — outreach blocked"
          >
            Opted out
          </ActionButton>
        </div>
      )}

      {seq.events.length > 0 && (
        <details className="border-t border-line px-4 py-3 text-[12.5px]">
          <summary className="cursor-pointer text-muted">History ({seq.events.length})</summary>
          <ol className="mt-2 space-y-1">
            {seq.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="text-ink-2">{e.type.replace("_", " ")}</span>
                <span className="text-faint">· {e.providerConfirmed ? "confirmed by email provider" : "recorded by recruiter"}</span>
                {e.note && <span className="text-muted">· {e.note}</span>}
                <span className="ml-auto text-faint">
                  {e.actorName} · {fmt(e.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        </details>
      )}
    </Card>
  );
}

function MessageRow({ m, seqStatus, canEdit, email }: { m: OutreachMessageView; seqStatus: string; canEdit: boolean; email: string | null }) {
  const [editing, setEditing] = useState(false);
  const [state, action, pending] = useServerForm(updateMessage.bind(null, m.id));
  const [tplState, tplAction, tplPending] = useServerForm(saveTemplate);
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) {
      setEditing(false);
      toast({ message: state.message ?? "Saved" });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => {
    if (tplState?.ok) toast({ message: "Saved as a template" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tplState]);
  const due = seqStatus === "active" && m.status === "approved" && !m.sentAt && m.dueAt && new Date(m.dueAt) <= new Date();
  const mailto = email ? `mailto:${encodeURIComponent(email)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}` : null;
  return (
    <div className="px-4 py-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="font-medium">Step {m.step}</span>
        <span className="text-muted">{m.step === 1 ? "First message" : `${m.delayDays} day${m.delayDays === 1 ? "" : "s"} after step ${m.step - 1}`}</span>
        {m.generator.startsWith("ai:") ? <AiMark label="AI draft" /> : <span className="text-faint">{m.generator.startsWith("template:") ? "From template" : "Plain draft"}</span>}
        {m.edited && <span className="text-warn">edited by recruiter</span>}
        <span className="ml-auto text-muted">
          {m.sentAt
            ? `${m.status === "sent" ? "Sent" : m.status.replace("_", " ")} ${fmt(m.sentAt)}${m.sentVia === "manual" ? " · recorded by recruiter" : ""}`
            : m.status === "approved"
              ? `Approved by ${m.approvedByName}${m.dueAt ? ` · due ${fmt(m.dueAt)}` : ""}`
              : m.status === "cancelled"
                ? "Cancelled"
                : "Not approved"}
        </span>
      </div>

      {editing ? (
        <ActionForm action={action} pending={pending} className="space-y-2">
          <Input name="subject" defaultValue={m.subject} maxLength={200} aria-label="Subject" />
          <Textarea name="body" defaultValue={m.body} rows={9} maxLength={6000} aria-label="Message" />
          {m.step > 1 && (
            <Field label="Days after previous step">
              <Input name="delayDays" type="number" min={0} max={30} defaultValue={m.delayDays} className="w-24" />
            </Field>
          )}
          <div className="flex items-center gap-2">
            <FormMessage state={state?.ok ? undefined : state} />
            <div className="ml-auto flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setEditing(false)}>
                Cancel
              </Button>
              <SubmitButton size="sm" pendingLabel="Saving…">
                Save
              </SubmitButton>
            </div>
          </div>
        </ActionForm>
      ) : (
        <div className="rounded-lg border border-line bg-[#fbfaf8] p-3">
          <div className="text-[13px] font-medium">{m.subject}</div>
          <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{m.body}</div>
        </div>
      )}

      {m.personalization.length > 0 && (
        <div className="mt-2 text-[12px]">
          <span className="text-muted">Personalized with: </span>
          {m.personalization.map((f) => (
            <span key={f.key} title={`Source: ${f.source}`} className="mr-1.5 inline-block rounded-md border border-line px-1.5 py-0.5 text-ink-2">
              {f.label}: {f.value}
            </span>
          ))}
        </div>
      )}

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {canEdit && !editing && (
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Edit
          </Button>
        )}
        {m.status === "draft" && canEdit && (
          <ActionButton action={() => approveMessage(m.id)} variant="primary" successMessage={`Step ${m.step} approved`}>
            Approve
          </ActionButton>
        )}
        {due && (
          <>
            {mailto && (
              <a href={mailto} className="inline-flex h-7 items-center rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-medium hover:bg-sunken">
                Open in email
              </a>
            )}
            <ActionButton action={() => recordSent(m.id)} variant="primary" confirm="Record this step as sent from your email?" successMessage="Recorded as sent">
              Mark as sent
            </ActionButton>
          </>
        )}
        <ActionForm action={tplAction} pending={tplPending} className="ml-auto">
          <input type="hidden" name="messageId" value={m.id} />
          <SubmitButton size="sm" variant="ghost" pendingLabel="Saving…">
            Save as template
          </SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}

export function NoApplicationOutreach() {
  return <EmptyState title="Add the candidate to a role first" body="Outreach is always tied to a specific role." />;
}
