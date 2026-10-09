"use client";

import { useEffect, useState } from "react";
import { ActionButton, ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { useToast } from "@/components/toast";
import { Button, Field, Input, Textarea } from "@/components/ui";
import { createInfoRequest, resolveTask } from "@/server/task-actions";
import { approveAndSendFollowUp, discardFollowUp, draftFollowUp, markFollowUpReplied, markFollowUpSent, recordFollowUpAnswers, saveFollowUpDraft } from "@/server/task-agent-actions";
import clsx from "clsx";
import { useRouter } from "next/navigation";

export type FollowUpView = {
  status: string | null;
  channel: string | null;
  subject: string | null;
  draft: string | null;
  draftedBy: string | null;
  approvedBy: string | null;
  sentAt: string | null;
  sentVia: string | null;
  to: string | null;
  error: string | null;
  replyAt: string | null;
  replyVia: string | null;
};
export type ChannelState = { blocked: string[]; provider: boolean; note?: string };
export type TaskView = { id: string; title: string; questions: string[]; dueAt: string | null; createdByName: string; createdAt: string; followUp: FollowUpView };

/** Open information requests for this application. Resolving one never records a decision. */
export function TasksCard({
  applicationId,
  tasks,
  suggested,
  channels,
}: {
  applicationId: string;
  tasks: TaskView[];
  suggested: string[];
  channels: { whatsapp: ChannelState; email: ChannelState };
}) {
  const [open, setOpen] = useState(false);
  const [key, setKey] = useState(0);
  const [state, action, pending] = useServerForm(createInfoRequest.bind(null, applicationId));
  const toast = useToast();
  useEffect(() => {
    if (state?.ok) {
      toast({ message: "Information request added to your queue" });
      setOpen(false);
      setKey((k) => k + 1);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  return (
    <div className="space-y-3">
      {tasks.length === 0 && !open && <p className="text-[13px] text-muted">No open information requests.</p>}
      {tasks.map((t) => (
        <div key={t.id} className="rounded-lg border border-line bg-[#fbfaf8] p-3">
          <div className="text-[13px] font-medium">{t.title}</div>
          {t.questions.length > 0 && (
            <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[12.5px] text-ink-2">
              {t.questions.map((q, i) => (
                <li key={i}>{q}</li>
              ))}
            </ul>
          )}
          <FollowUpAgent taskId={t.id} f={t.followUp} channels={channels} />
          <div className="mt-2 flex flex-wrap items-center gap-1 text-[11.5px] text-faint">
            <span>
              {t.createdByName} · {new Date(t.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
              {t.dueAt ? ` · due ${new Date(t.dueAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}` : ""}
            </span>
            <span className="ml-auto flex gap-1">
              <ActionButton action={() => resolveTask(t.id, "done")} variant="secondary" successMessage="Marked done — no decision was recorded">
                Done
              </ActionButton>
              <ActionButton action={() => resolveTask(t.id, "cancelled")} variant="ghost" successMessage="Request cancelled">
                Cancel
              </ActionButton>
            </span>
          </div>
        </div>
      ))}
      {open ? (
        <ActionForm key={key} action={action} pending={pending} className="space-y-2.5 rounded-lg border border-line p-3">
          <Field label="Title">
            <Input name="title" defaultValue="Gather more information" maxLength={200} />
          </Field>
          <Field label="Questions" hint="One per line. Job-related only.">
            <Textarea name="questions" rows={4} defaultValue={suggested.join("\n")} maxLength={4000} />
          </Field>
          <Field label="Due (optional)">
            <Input name="dueAt" type="date" />
          </Field>
          <div className="flex items-center gap-2">
            <FormMessage state={state?.ok ? undefined : state} />
            <div className="ml-auto flex gap-2">
              <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <SubmitButton size="sm" pendingLabel="Saving…">
                Add to queue
              </SubmitButton>
            </div>
          </div>
        </ActionForm>
      ) : (
        <Button size="sm" onClick={() => setOpen(true)}>
          Request more information
        </Button>
      )}
    </div>
  );
}

const fmt = (d: string) => new Date(d).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
const STEPS = ["Draft", "Your approval", "Sent", "Reply", "Answers"] as const;

/**
 * The assistant follow-up for one information request: drafts the questions as a message, waits
 * for the recruiter's approval, sends through the connected provider (or records a manual send),
 * watches for the provider-reported reply, then takes the answers back into the profile.
 */
function FollowUpAgent({ taskId, f, channels }: { taskId: string; f: FollowUpView; channels: { whatsapp: ChannelState; email: ChannelState } }) {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [subject, setSubject] = useState(f.subject ?? "");
  const [body, setBody] = useState(f.draft ?? "");
  const [answers, setAnswers] = useState("");
  const [reassess, setReassess] = useState(true);
  useEffect(() => {
    setSubject(f.subject ?? "");
    setBody(f.draft ?? "");
  }, [f.subject, f.draft]);
  const run = async (key: string, fn: () => Promise<{ error?: string; message?: string } | undefined>) => {
    setBusy(key);
    setError(null);
    const r: { error?: string; message?: string } | undefined = await fn().catch(() => ({ error: "Something went wrong. Try again." }));
    setBusy(null);
    if (r?.error) return setError(r.error);
    if (r?.message) toast({ message: r.message });
    router.refresh();
  };
  const step = !f.status ? 0 : f.status === "drafted" ? 1 : f.status === "sent" || f.status === "failed" ? 3 : f.status === "replied" ? 4 : 5;
  const ch = (f.channel ?? "whatsapp") as "whatsapp" | "email";
  const chLabel = ch === "whatsapp" ? "WhatsApp" : "email";

  return (
    <div className="mt-2.5 rounded-lg border border-line bg-surface p-2.5">
      <div className="mb-2 flex items-center gap-1.5">
        <span className="inline-flex items-center rounded-md bg-brand-soft px-1.5 py-0.5 text-[10.5px] font-semibold uppercase tracking-wide text-brand">Assistant</span>
        <ol className="flex flex-wrap items-center gap-1 text-[11px]" aria-label="Follow-up steps">
          {STEPS.map((label, i) => (
            <li key={label} className={clsx("flex items-center gap-1", i < step ? "text-ok" : i === step ? "font-semibold text-ink" : "text-faint")}>
              <span aria-hidden>{i < step ? "✓" : i === step ? "•" : "○"}</span>
              {label}
              {i < STEPS.length - 1 && <span aria-hidden className="text-faint">›</span>}
            </li>
          ))}
        </ol>
      </div>

      {step === 0 && (
        <div className="space-y-1.5">
          <p className="text-[12px] text-muted">Ask the candidate these questions. The assistant drafts the message; nothing is sent until you approve it.</p>
          <div className="flex flex-wrap gap-1.5">
            {(["whatsapp", "email"] as const).map((c) => (
              <Button key={c} size="sm" variant="secondary" disabled={!!busy || channels[c].blocked.length > 0} title={channels[c].blocked.join(" ") || undefined} onClick={() => run(c, () => draftFollowUp(taskId, c))}>
                {busy === c ? "Drafting…" : c === "whatsapp" ? "Ask on WhatsApp" : "Ask by email"}
              </Button>
            ))}
          </div>
          {(["whatsapp", "email"] as const).map((c) =>
            channels[c].blocked.length ? (
              <p key={c} className="text-[11.5px] text-faint">
                {c === "whatsapp" ? "WhatsApp" : "Email"}: {channels[c].blocked.join(" ")}
              </p>
            ) : null,
          )}
        </div>
      )}

      {step === 1 && (
        <div className="space-y-2">
          <p className="text-[11.5px] text-muted">
            Draft for {chLabel} · {f.draftedBy?.startsWith("ai:") ? "written by AI from your questions" : "built from your questions (no AI)"} — edit freely.
          </p>
          {ch === "email" && <Input value={subject} onChange={(e) => setSubject(e.target.value)} className="h-8 text-[12.5px]" aria-label="Subject" maxLength={200} />}
          <Textarea value={body} onChange={(e) => setBody(e.target.value)} rows={7} maxLength={4000} className="text-[12.5px]" aria-label="Message" />
          {ch === "whatsapp" && channels.whatsapp.note && <p className="text-[11.5px] text-faint">{channels.whatsapp.note}</p>}
          <div className="flex flex-wrap gap-1.5">
            {(subject !== (f.subject ?? "") || body !== (f.draft ?? "")) && (
              <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run("save", () => saveFollowUpDraft(taskId, subject, body))}>
                {busy === "save" ? "Saving…" : "Save edits"}
              </Button>
            )}
            {channels[ch].provider ? (
              <Button
                size="sm"
                variant="primary"
                disabled={!!busy || subject !== (f.subject ?? "") || body !== (f.draft ?? "")}
                title={subject !== (f.subject ?? "") || body !== (f.draft ?? "") ? "Save your edits first" : undefined}
                onClick={() => {
                  if (window.confirm(`Send this ${chLabel} message to the candidate now?`)) run("send", () => approveAndSendFollowUp(taskId));
                }}
              >
                {busy === "send" ? "Sending…" : `Approve & send on ${chLabel}`}
              </Button>
            ) : (
              <>
                <Button size="sm" variant="secondary" onClick={() => navigator.clipboard?.writeText(body).then(() => toast({ message: "Copied — send it yourself" }))}>
                  Copy message
                </Button>
                <Button size="sm" variant="primary" disabled={!!busy} onClick={() => run("manual", () => markFollowUpSent(taskId))}>
                  {busy === "manual" ? "Saving…" : "Mark as sent"}
                </Button>
              </>
            )}
            <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("discard", () => discardFollowUp(taskId))}>
              Discard
            </Button>
          </div>
          {!channels[ch].provider && <p className="text-[11.5px] text-faint">{chLabel === "WhatsApp" ? "WhatsApp" : "Email sending"} isn&apos;t connected, so Talyn can&apos;t send it. Copy it, send it yourself, then mark it as sent.</p>}
        </div>
      )}

      {step === 3 && (
        <div className="space-y-1.5 text-[12.5px]">
          {f.status === "failed" ? (
            <p className="text-danger">{f.error}</p>
          ) : (
            <p>
              Sent on {chLabel} to {f.to} · {f.sentAt && fmt(f.sentAt)} · approved by {f.approvedBy} ·{" "}
              {f.sentVia === "manual" ? "sent by you" : `accepted by ${f.sentVia}`}. Waiting for a reply
              {f.sentVia === "manual" ? " — record it when it comes." : " — it appears here when the provider reports it."}
            </p>
          )}
          <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run("reply", () => markFollowUpReplied(taskId))}>
            {busy === "reply" ? "Saving…" : "They replied"}
          </Button>
        </div>
      )}

      {step === 4 && (
        <div className="space-y-2 text-[12.5px]">
          <p>
            Candidate replied {f.replyAt && fmt(f.replyAt)} ({f.replyVia === "WhatsApp" || f.replyVia === "Email provider" ? `reported by ${f.replyVia}` : "recorded by a recruiter"}). Read it in{" "}
            {chLabel === "WhatsApp" ? "WhatsApp" : "your inbox"} — Talyn doesn&apos;t store message text — then add the answers here.
          </p>
          <Textarea value={answers} onChange={(e) => setAnswers(e.target.value)} rows={4} maxLength={6000} placeholder="Paste or summarise the candidate's answers" aria-label="Candidate's answers" />
          <label className="flex items-center gap-2 text-[12px]">
            <input type="checkbox" checked={reassess} onChange={(e) => setReassess(e.target.checked)} />
            Reassess this candidate with the new answers
          </label>
          <Button size="sm" variant="primary" disabled={!!busy} onClick={() => run("answers", () => recordFollowUpAnswers(taskId, answers, reassess))}>
            {busy === "answers" ? (reassess ? "Saving and reassessing…" : "Saving…") : "Add answers to profile"}
          </Button>
          <p className="text-[11.5px] text-faint">Added to candidate-provided information with the channel and date, so they can be used as evidence. No decision is recorded.</p>
        </div>
      )}
      {error && <p className="mt-1.5 text-[12px] text-danger">{error}</p>}
    </div>
  );
}
