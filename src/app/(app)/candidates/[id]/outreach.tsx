"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ActionButton, ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { useToast } from "@/components/toast";
import { AiMark, Button, Card, EmptyState, Field, Input, Notice, Select, Textarea } from "@/components/ui";
import { setInterest, setWhatsappPermission } from "@/server/contact-actions";
import { INTEREST_CHANNELS, INTEREST_CHANNEL_LABEL, INTEREST_LABEL } from "@/lib/domain";
import {
  activateSequence,
  approveAll,
  approveMessage,
  draftSequence,
  pauseSequence,
  recordOutcome,
  recordSent,
  regenerateMessage,
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
  deliveredAt: string | null;
};
export type OutreachView = {
  applicationId: string;
  candidateId: string;
  candidateName: string;
  roleTitle: string;
  origin: string;
  isSample: boolean;
  email: string | null;
  emailOrigin: string | null;
  phone: string | null;
  phoneOrigin: string | null;
  phoneIntl: boolean;
  optedOut: boolean;
  whatsappPermission: { status: string; at: string | null; note: string | null; by: string | null };
  interest: { value: string; at: string | null; by: string | null; note: string | null; channel: string | null; source: string | null };
  aiConfigured: boolean;
  emailProvider: { connected: boolean; label: string | null };
  whatsapp: { connected: boolean; templateName: string | null; templatePreview: string | null; usesMessageParam: boolean };
  company: string;
  senderName: string;
  templates: { id: string; name: string }[];
  sequence: null | {
    id: string;
    channel: "email" | "whatsapp";
    status: string;
    stopReason: string | null;
    activatedByName: string | null;
    activatedAt: string | null;
    messages: OutreachMessageView[];
    events: { id: string; type: string; actorName: string; providerConfirmed: boolean; note: string | null; createdAt: string }[];
  };
};

const STATUS: Record<string, { label: string; tone: string }> = {
  draft: { label: "Draft — nothing sent", tone: "bg-sunken text-ink-2" },
  active: { label: "Active", tone: "bg-ok-soft text-ok" },
  paused: { label: "Paused", tone: "bg-warn-soft text-warn" },
  stopped: { label: "Cancelled", tone: "bg-sunken text-muted" },
  completed: { label: "All steps sent", tone: "bg-sunken text-ink-2" },
};
const STOP_REASON: Record<string, string> = {
  replied: "candidate replied",
  declined: "candidate declined",
  opted_out: "candidate opted out",
  bounced: "message bounced",
  recruiter: "cancelled by recruiter",
  permission_withdrawn: "WhatsApp permission withdrawn",
};
const INTEREST = INTEREST_LABEL;
const fmt = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

type Channel = "email" | "whatsapp";

/** Whether Talyn could send on a channel right now, and why not. Drafting is always allowed. */
function channelState(v: OutreachView, ch: Channel): { canSend: boolean; manual: boolean; issues: string[] } {
  const issues: string[] = [];
  if (v.isSample) issues.push("Fictional sample person — no one to contact");
  if (v.optedOut) issues.push("Candidate opted out of all contact");
  if (ch === "email") {
    if (!v.email) issues.push("No email address on file — Talyn never guesses contact details");
    return { canSend: !issues.length, manual: !v.emailProvider.connected, issues };
  }
  if (!v.phone) issues.push("No phone number on file");
  else if (!v.phoneIntl) issues.push("Phone number needs a country code (e.g. +44…)");
  if (v.whatsappPermission.status !== "granted") issues.push("WhatsApp permission not recorded");
  if (!v.whatsapp.connected) issues.push("WhatsApp isn't connected — sending is disabled");
  return { canSend: !issues.length, manual: false, issues };
}

export function OutreachPanel({ v }: { v: OutreachView }) {
  const seq = v.sequence;
  const live = seq && ["draft", "active", "paused"].includes(seq.status);
  return (
    <div className="space-y-4">
      {v.isSample && <Notice tone="warn">Fictional sample person. You can try drafting, but nothing can be sent.</Notice>}
      {v.optedOut && <Notice tone="danger">This candidate opted out of contact. Outreach is blocked on every channel.</Notice>}
      <ContactAndPermission v={v} />
      {!live && !v.optedOut && <Composer v={v} hasHistory={!!seq} />}
      {seq && <SequenceCard v={v} seq={seq} />}
    </div>
  );
}

/** Contact details, channel permission and expressed interest — kept apart from role fit. */
function ContactAndPermission({ v }: { v: OutreachView }) {
  const email = channelState(v, "email");
  const wa = channelState(v, "whatsapp");
  return (
    <Card className="grid gap-4 p-4 md:grid-cols-3">
      <div className="space-y-1 text-[12.5px]">
        <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Email</div>
        <div>{v.email ? <>{v.email} <span className="text-faint">· {v.emailOrigin}</span></> : <span className="text-warn">No email on file</span>}</div>
        <div className={email.canSend ? (email.manual ? "text-warn" : "text-ok") : "text-muted"}>
          {!email.canSend ? "Can't send" : email.manual ? "Email sending not connected — you send it yourself and record it" : `Sends via ${v.emailProvider.label}`}
        </div>
      </div>
      <div className="space-y-1 text-[12.5px]">
        <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">WhatsApp</div>
        <div>{v.phone ? <>{v.phone} <span className="text-faint">· {v.phoneOrigin}</span></> : <span className="text-warn">No phone on file</span>}</div>
        <WhatsAppPermission v={v} />
        <div className={wa.canSend ? "text-ok" : "text-muted"}>{wa.canSend ? "Ready to send" : v.whatsapp.connected ? "Can't send yet" : "WhatsApp not connected — sending disabled"}</div>
      </div>
      <InterestRecorder v={v} />
    </Card>
  );
}

function WhatsAppPermission({ v }: { v: OutreachView }) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const p = v.whatsappPermission;
  const save = async (status: "granted" | "withdrawn") => {
    const r = await setWhatsappPermission(v.candidateId, status, note).catch(() => ({ error: "Couldn't save. Try again." }));
    if (r?.error) return setErr(r.error);
    setOpen(false);
    setNote("");
    router.refresh();
  };
  return (
    <div>
      <span className="text-muted">Permission: </span>
      {p.status === "granted" ? (
        <span className="text-ok" title={p.note ?? undefined}>
          Opt-in recorded{p.at ? ` ${new Date(p.at).toLocaleDateString()}` : ""}
          {p.by ? ` by ${p.by}` : ""}
        </span>
      ) : p.status === "withdrawn" ? (
        <span className="text-danger">Withdrawn</span>
      ) : (
        <span className="text-warn">Not recorded</span>
      )}
      {!v.isSample && !v.optedOut && (
        <button type="button" onClick={() => (p.status === "granted" ? save("withdrawn") : setOpen(!open))} className="ml-2 text-[12px] underline hover:text-ink">
          {p.status === "granted" ? "Withdraw" : "Record opt-in"}
        </button>
      )}
      {p.note && p.status === "granted" && <div className="text-[11.5px] text-faint">“{p.note}”</div>}
      {open && (
        <div className="mt-1.5 space-y-1.5 rounded-md border border-line-strong p-2">
          <label className="block text-[12px] font-medium" htmlFor={`wa-note-${v.candidateId}`}>
            How and when did they agree to WhatsApp messages?
          </label>
          <Input id={`wa-note-${v.candidateId}`} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Asked to continue on WhatsApp in their email reply, 3 Oct" className="h-8 text-[12.5px]" />
          <div className="flex items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => save("granted")}>
              Record opt-in
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
          {err && <p className="text-[12px] text-danger">{err}</p>}
          <p className="text-[11px] text-faint">Only record permission the candidate actually gave. Talyn won&apos;t send on WhatsApp without it.</p>
        </div>
      )}
    </div>
  );
}

function InterestRecorder({ v }: { v: OutreachView }) {
  const [value, setValue] = useState(v.interest.value);
  const [note, setNote] = useState(v.interest.note ?? "");
  const [channel, setChannel] = useState(v.interest.channel ?? "");
  const [source, setSource] = useState(v.interest.source ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const known = value !== "not_expressed";
  const unchanged = value === v.interest.value && note === (v.interest.note ?? "") && channel === (v.interest.channel ?? "") && source === (v.interest.source ?? "");
  return (
    <div className="space-y-1 text-[12.5px]">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Expressed interest</div>
      <p className="text-[11.5px] text-faint">Only what they told you — Unknown until recorded. Never inferred from profiles, activity or AI. Separate from contact permission.</p>
      <div className="flex gap-1.5">
        <Select value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Expressed interest">
          {Object.entries(INTEREST).map(([k, label]) => (
            <option key={k} value={k}>
              {label}
            </option>
          ))}
        </Select>
        <Button
          size="sm"
          disabled={unchanged}
          onClick={async () => {
            const r = await setInterest(v.applicationId, value, note, channel, source).catch(() => ({ error: "Couldn't save." }));
            setMsg(r?.error ?? "Saved");
            router.refresh();
          }}
        >
          Save
        </Button>
      </div>
      {known && (
        <div className="flex flex-wrap gap-1.5">
          <Select value={channel} onChange={(e) => setChannel(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Channel the candidate used">
            <option value="">How did they tell you?</option>
            {INTEREST_CHANNELS.map((c) => (
              <option key={c} value={c}>
                {INTEREST_CHANNEL_LABEL[c]}
              </option>
            ))}
          </Select>
          <Input value={source} onChange={(e) => setSource(e.target.value)} placeholder="When / where, e.g. reply to email of 3 Oct" className="h-8 min-w-48 flex-1 text-[12.5px]" aria-label="When and where it was expressed" maxLength={300} />
        </div>
      )}
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note, incl. any restriction (optional)" className="h-8 text-[12.5px]" aria-label="Interest note" />
      {v.interest.at && (
        <div className="text-[11.5px] text-faint">
          Recorded {new Date(v.interest.at).toLocaleDateString()}
          {v.interest.by ? ` by ${v.interest.by}` : ""}
          {v.interest.channel ? ` · via ${INTEREST_CHANNEL_LABEL[v.interest.channel] ?? v.interest.channel}` : ""}
          {v.interest.source ? ` · ${v.interest.source}` : ""}
        </div>
      )}
      {value === "declined" && value !== v.interest.value && <p className="text-[11.5px] text-warn">Saving “Declined” cancels any unsent follow-ups.</p>}
      {msg && <p className="text-[11.5px] text-muted">{msg}</p>}
    </div>
  );
}

function Composer({ v, hasHistory }: { v: OutreachView; hasHistory: boolean }) {
  const [state, action, pending] = useServerForm(draftSequence.bind(null, v.applicationId));
  const [followUps, setFollowUps] = useState(2);
  const [channel, setChannel] = useState<Channel>(v.email || !v.phone ? "email" : "whatsapp");
  const toast = useToast();
  const st = channelState(v, channel);
  useEffect(() => {
    if (state?.ok) toast({ message: state.message ?? "Draft ready" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <Card className="p-4">
      <div className="mb-1 font-medium">{hasHistory ? "Start a new sequence" : "Draft outreach"}</div>
      <p className="mb-3 text-[12.5px] text-muted">
        A first message and {followUps} follow-ups, drafted from the role and the evidence shown in Talyn only. You edit and approve every message; nothing is sent until you activate.
      </p>
      <ActionForm action={action} pending={pending} className="space-y-3">
        <fieldset>
          <legend className="mb-1 text-[13px] font-medium">Channel</legend>
          <div className="grid gap-2 sm:grid-cols-2">
            {(["email", "whatsapp"] as const).map((c) => {
              const s = channelState(v, c);
              return (
                <label key={c} className={clsx("flex cursor-pointer gap-2 rounded-lg border p-2.5 text-[12.5px]", channel === c ? "border-ink bg-sunken" : "border-line-strong hover:bg-sunken/60")}>
                  <input type="radio" name="channel" value={c} checked={channel === c} onChange={() => setChannel(c)} className="mt-0.5" />
                  <span>
                    <span className="font-medium text-ink">{c === "email" ? "Email" : "WhatsApp"}</span>
                    <span className={clsx("block", s.canSend ? (s.manual ? "text-warn" : "text-ok") : "text-muted")}>
                      {s.canSend ? (s.manual ? "Draft now · you send it yourself" : "Draft now · can send after approval") : `Draft only · ${s.issues[0]}`}
                    </span>
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
        {channel === "whatsapp" && (
          <Notice>
            WhatsApp requires an approved message template for the first contact.{" "}
            {v.whatsapp.connected
              ? `Talyn sends your template “${v.whatsapp.templateName}”${v.whatsapp.usesMessageParam ? " with the approved draft text in its message field" : ""}. The preview shows exactly what goes out.`
              : "Once WhatsApp is connected, Talyn sends your approved template; until then drafts can't be sent."}
          </Notice>
        )}
        <div className="flex flex-wrap items-end gap-3">
          <Field label="Follow-ups">
            <Select name="followUps" value={followUps} onChange={(e) => setFollowUps(Number(e.target.value))} className="w-auto">
              <option value={2}>2 follow-ups</option>
              <option value={3}>3 follow-ups</option>
            </Select>
          </Field>
          <Field label="1st follow-up after (days)">
            <Input name="delay2" type="number" min={1} max={30} defaultValue={4} className="w-24" />
          </Field>
          <Field label="2nd after">
            <Input name="delay3" type="number" min={1} max={30} defaultValue={7} className="w-24" />
          </Field>
          {followUps >= 3 && (
            <Field label="3rd after">
              <Input name="delay4" type="number" min={1} max={30} defaultValue={14} className="w-24" />
            </Field>
          )}
          {channel === "email" && v.templates.length > 0 && (
            <Field label="First message from">
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
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <SubmitButton variant={v.aiConfigured ? "signal" : "secondary"} pendingLabel="Drafting…">
            {v.aiConfigured ? "Draft with AI" : "Draft messages"}
          </SubmitButton>
          {!v.aiConfigured && <span className="text-[12px] text-muted">AI is off — plain drafts built from the evidence.</span>}
          <FormMessage state={state?.ok ? undefined : state} />
        </div>
        <p className="text-[11.5px] text-faint">Drafts never claim the person is looking for a job or has shown interest, and never invent details or a relationship.</p>
      </ActionForm>
    </Card>
  );
}

function SequenceCard({ v, seq }: { v: OutreachView; seq: NonNullable<OutreachView["sequence"]> }) {
  const allApproved = seq.messages.filter((m) => !m.sentAt && m.status !== "cancelled").every((m) => m.status !== "draft");
  const canEdit = ["draft", "paused"].includes(seq.status);
  const ch = channelState(v, seq.channel);
  const s = STATUS[seq.status] ?? { label: seq.status, tone: "bg-sunken" };
  const checks = [
    { ok: allApproved, label: "Every message approved" },
    ...(seq.channel === "email"
      ? [
          { ok: !!v.email, label: "Email address on file" },
          { ok: v.emailProvider.connected, label: v.emailProvider.connected ? `Email sending connected (${v.emailProvider.label})` : "Email sending not connected — you'll send from your own mail client", soft: true },
        ]
      : [
          { ok: v.phoneIntl, label: "Phone number with country code" },
          { ok: v.whatsappPermission.status === "granted", label: "WhatsApp opt-in recorded" },
          { ok: v.whatsapp.connected, label: "WhatsApp connected" },
        ]),
    { ok: !v.optedOut && !v.isSample, label: "Not opted out" },
  ];
  const blockers = checks.filter((c) => !c.ok && !("soft" in c && c.soft));
  return (
    <Card className="overflow-hidden">
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-[#fbfaf8] px-4 py-3">
        <span className="font-medium">{seq.channel === "whatsapp" ? "WhatsApp" : "Email"} sequence</span>
        <span className={clsx("rounded-md px-1.5 py-0.5 text-[12px] font-medium", s.tone)}>
          {s.label}
          {seq.stopReason && seq.status !== "active" ? ` · ${STOP_REASON[seq.stopReason] ?? seq.stopReason.replace("_", " ")}` : ""}
        </span>
        {seq.activatedAt && <span className="text-[12px] text-muted">activated {fmt(seq.activatedAt)} by {seq.activatedByName}</span>}
        <span className="ml-auto flex flex-wrap gap-1.5">
          {canEdit && !allApproved && (
            <ActionButton action={() => approveAll(seq.id)} successMessage="All messages approved">
              Approve all
            </ActionButton>
          )}
          {canEdit && (
            <ActionButton
              action={() => activateSequence(seq.id)}
              variant="primary"
              confirm={
                seq.status === "paused"
                  ? "Resume this sequence? Due approved messages become sendable again."
                  : ch.canSend && !ch.manual
                    ? `Send the first message to ${v.candidateName} now? Follow-ups go out on their delays and stop automatically on a reply, decline, opt-out or your pause.`
                    : "Activate this sequence? Email sending isn't connected, so you'll send each due message from your own mail client and record it."
              }
              successMessage={seq.status === "paused" ? "Sequence resumed" : "Sequence activated"}
            >
              {seq.status === "paused" ? "Resume" : ch.canSend && !ch.manual ? "Approve & send first message" : "Activate"}
            </ActionButton>
          )}
          {seq.status === "active" && (
            <ActionButton action={() => pauseSequence(seq.id)} successMessage="Paused — nothing more will be sent until you resume">
              Pause
            </ActionButton>
          )}
          {["draft", "active", "paused"].includes(seq.status) && (
            <ActionButton action={() => stopSequence(seq.id)} variant="ghost" confirm="Cancel this sequence? Unsent messages are cancelled." successMessage="Sequence cancelled">
              Cancel sequence
            </ActionButton>
          )}
        </span>
      </div>

      {canEdit && (
        <div className="border-b border-line px-4 py-2.5 text-[12.5px]">
          <div className="mb-1 font-medium">Before anything is sent</div>
          <ul className="flex flex-wrap gap-x-4 gap-y-0.5">
            {checks.map((c) => (
              <li key={c.label} className={c.ok ? "text-ok" : "soft" in c && c.soft ? "text-warn" : "text-muted"}>
                {c.ok ? "✓" : "○"} {c.label}
              </li>
            ))}
          </ul>
          {blockers.length > 0 && <p className="mt-1 text-[12px] text-muted">Activation stays disabled on the server until these are met.</p>}
        </div>
      )}

      <div className="divide-y divide-line">
        {seq.messages.map((m) => (
          <MessageRow key={m.id} v={v} m={m} channel={seq.channel} seqStatus={seq.status} canEdit={canEdit && !m.sentAt && m.status !== "cancelled"} />
        ))}
      </div>

      {(seq.status === "active" || seq.status === "paused" || seq.status === "completed") && seq.messages.some((m) => m.sentAt) && (
        <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 text-[12.5px]">
          <span className="text-muted">Record what happened (stops or pauses follow-ups):</span>
          <ActionButton action={() => recordOutcome(seq.id, "replied")} successMessage="Reply recorded — follow-ups stopped and a task added">
            Replied
          </ActionButton>
          <ActionButton action={() => recordOutcome(seq.id, "declined")} successMessage="Decline recorded — follow-ups stopped">
            Declined
          </ActionButton>
          {seq.channel === "email" && (
            <ActionButton action={() => recordOutcome(seq.id, "bounced")} variant="ghost" successMessage="Bounce recorded — sequence paused">
              Bounced
            </ActionButton>
          )}
          <ActionButton action={() => recordOutcome(seq.id, "opted_out")} variant="ghost" confirm="Record that the candidate opted out? All outreach to them will be blocked." successMessage="Opt-out recorded — outreach blocked">
            Opted out
          </ActionButton>
        </div>
      )}

      <details className="border-t border-line px-4 py-3 text-[12.5px]" open={seq.status !== "draft"}>
        <summary className="cursor-pointer text-muted">Activity ({seq.events.length})</summary>
        {seq.events.length === 0 ? (
          <p className="mt-1 text-faint">No activity yet.</p>
        ) : (
          <ol className="mt-2 space-y-1">
            {seq.events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-2">
                <span className="text-ink-2">{e.type.replace(/_/g, " ")}</span>
                <span className="text-faint">· {e.providerConfirmed ? "confirmed by provider" : "recorded in Talyn"}</span>
                {e.note && <span className="text-muted">· {e.note}</span>}
                <span className="ml-auto text-faint">
                  {e.actorName} · {fmt(e.createdAt)}
                </span>
              </li>
            ))}
          </ol>
        )}
      </details>
    </Card>
  );
}

function MessageRow({ v, m, channel, seqStatus, canEdit }: { v: OutreachView; m: OutreachMessageView; channel: Channel; seqStatus: string; canEdit: boolean }) {
  const [editing, setEditing] = useState(false);
  const [preview, setPreview] = useState(false);
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
  const manualEmail = channel === "email" && !v.emailProvider.connected && !!v.email && !v.isSample;
  const mailto = manualEmail ? `mailto:${encodeURIComponent(v.email!)}?subject=${encodeURIComponent(m.subject)}&body=${encodeURIComponent(m.body)}` : null;
  return (
    <div className="px-4 py-4">
      <div className="mb-2 flex flex-wrap items-center gap-2 text-[12.5px]">
        <span className="font-medium">{m.step === 1 ? "First message" : `Follow-up ${m.step - 1}`}</span>
        <span className="text-muted">{m.step === 1 ? "sent when you activate" : `${m.delayDays} day${m.delayDays === 1 ? "" : "s"} after the previous message`}</span>
        {m.generator.startsWith("ai:") ? <AiMark label="AI draft" /> : <span className="text-faint">{m.generator.startsWith("template:") ? "From template" : "Plain draft"}</span>}
        {m.edited && <span className="text-warn">edited by recruiter</span>}
        <span className="ml-auto text-muted">
          {m.sentAt
            ? `${m.status === "sent" ? "Sent" : m.status.replace("_", " ")} ${fmt(m.sentAt)}${m.sentVia === "manual" ? " · recorded by recruiter" : ""}${m.deliveredAt ? " · delivered" : ""}`
            : m.status === "approved"
              ? `Approved by ${m.approvedByName}${m.dueAt ? ` · due ${fmt(m.dueAt)}` : ""}`
              : m.status === "cancelled"
                ? "Cancelled"
                : "Not approved"}
        </span>
      </div>

      {editing ? (
        <ActionForm action={action} pending={pending} className="space-y-2">
          {channel === "email" && <Input name="subject" defaultValue={m.subject} maxLength={200} aria-label="Subject" />}
          <Textarea name="body" defaultValue={m.body} rows={channel === "whatsapp" ? 5 : 9} maxLength={channel === "whatsapp" ? 1000 : 6000} aria-label="Message" />
          {m.step > 1 && (
            <Field label="Days after the previous message">
              <Input name="delayDays" type="number" min={1} max={30} defaultValue={m.delayDays} className="w-24" />
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
      ) : preview ? (
        <Preview v={v} m={m} channel={channel} />
      ) : (
        <div className="rounded-lg border border-line bg-[#fbfaf8] p-3">
          {channel === "email" && <div className="text-[13px] font-medium">{m.subject}</div>}
          <div className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2">{m.body}</div>
        </div>
      )}

      {m.personalization.length > 0 && (
        <div className="mt-2 text-[12px]">
          <span className="text-muted">Uses only: </span>
          {m.personalization.map((f) => (
            <span key={f.key} title={`Source: ${f.source}`} className="mr-1.5 inline-block rounded-md border border-line px-1.5 py-0.5 text-ink-2">
              {f.label}: {f.value.length > 60 ? `${f.value.slice(0, 60)}…` : f.value}
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
        {canEdit && !editing && (
          <ActionButton action={() => regenerateMessage(m.id)} variant="ghost" pendingLabel="Redrafting…" successMessage="Redrafted — approve it again">
            Regenerate
          </ActionButton>
        )}
        {!editing && (
          <Button size="sm" variant="ghost" onClick={() => setPreview(!preview)} aria-pressed={preview}>
            {preview ? "Back to draft" : "Preview"}
          </Button>
        )}
        {m.status === "draft" && canEdit && (
          <ActionButton action={() => approveMessage(m.id)} variant="primary" successMessage={`${m.step === 1 ? "First message" : `Follow-up ${m.step - 1}`} approved`}>
            Approve
          </ActionButton>
        )}
        {due && manualEmail && (
          <>
            {mailto && (
              <a href={mailto} className="inline-flex h-7 items-center rounded-lg border border-line-strong bg-surface px-2.5 text-[13px] font-medium hover:bg-sunken">
                Open in email
              </a>
            )}
            <ActionButton action={() => recordSent(m.id)} variant="primary" confirm="Record this message as sent from your own email?" successMessage="Recorded as sent">
              Mark as sent
            </ActionButton>
          </>
        )}
        {channel === "email" && (
          <ActionForm action={tplAction} pending={tplPending} className="ml-auto">
            <input type="hidden" name="messageId" value={m.id} />
            <SubmitButton size="sm" variant="ghost" pendingLabel="Saving…">
              Save as template
            </SubmitButton>
          </ActionForm>
        )}
      </div>
    </div>
  );
}

/** What the candidate would receive. For WhatsApp, the approved template is what's actually sent. */
function Preview({ v, m, channel }: { v: OutreachView; m: OutreachMessageView; channel: Channel }) {
  if (channel === "whatsapp") {
    const sent = v.whatsapp.templatePreview
      ? v.whatsapp.usesMessageParam
        ? v.whatsapp.templatePreview.replace("[your approved message]", m.body)
        : v.whatsapp.templatePreview
      : null;
    return (
      <div className="rounded-lg bg-[#e7ddd3] p-3">
        <div className="mb-1 text-[11.5px] text-ink-2">
          To {v.phone ?? "— no phone on file"} · WhatsApp {v.whatsapp.connected ? "" : "(not connected)"}
        </div>
        <div className="ml-auto max-w-sm whitespace-pre-wrap rounded-lg rounded-tr-none bg-[#dcf8c6] px-3 py-2 text-[13px] leading-relaxed text-ink shadow-sm">{sent ?? m.body}</div>
        <p className="mt-1.5 text-[11.5px] text-ink-2">
          {sent
            ? `Your approved template “${v.whatsapp.templateName}”${v.whatsapp.usesMessageParam ? " with this draft in its message field" : " — the draft text itself isn't sent"}.`
            : v.whatsapp.connected
              ? "Set WHATSAPP_TEMPLATE_PREVIEW to see the exact approved template here."
              : "Draft only — WhatsApp isn't connected, so this can't be sent."}
        </p>
      </div>
    );
  }
  return (
    <div className="overflow-hidden rounded-lg border border-line-strong bg-surface text-[13px]">
      <dl className="grid grid-cols-[64px_1fr] gap-y-0.5 border-b border-line bg-sunken/60 px-3 py-2 text-[12px]">
        <dt className="text-muted">From</dt>
        <dd>
          {v.senderName} · {v.company}
        </dd>
        <dt className="text-muted">To</dt>
        <dd>{v.email ?? <span className="text-warn">no email on file</span>}</dd>
        <dt className="text-muted">Subject</dt>
        <dd className="font-medium">{m.subject}</dd>
      </dl>
      <div className="whitespace-pre-wrap px-3 py-3 leading-relaxed text-ink-2">{m.body}</div>
      {v.emailProvider.connected && <div className="border-t border-line px-3 py-1.5 text-[11.5px] text-faint">— To stop hearing from us: [unsubscribe link added when sent]</div>}
    </div>
  );
}

export function NoApplicationOutreach() {
  return <EmptyState title="Add the candidate to a role first" body="Outreach is always tied to a specific role." />;
}
