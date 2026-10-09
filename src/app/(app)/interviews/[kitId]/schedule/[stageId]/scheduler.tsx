"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { ActionForm, FormMessage, Spinner, SubmitButton, useServerForm } from "@/components/client";
import { EventCard, type EventView } from "@/components/calendar/event-card";
import { StagedProgress } from "@/components/staged-progress";
import { useToast } from "@/components/toast";
import { Badge, Button, Card, Field, Input, Notice, Select } from "@/components/ui";
import { formatInZone } from "@/lib/calendar/time";
import { findSlotsAction, previewProposal, proposeTimes, rescheduleInterview, saveSchedulingSetup, saveWindows, scheduleInterview, type SlotResult } from "@/server/scheduling-actions";

type Row = { date: string; start: string; end: string };
export type SchedulerProps = {
  stageId: string;
  stageName: string;
  roleTitle: string;
  live: boolean;
  myConnection: string | null; // status of the scheduler's own Google connection
  connectHref: string;
  candidate: { name: string; isSample: boolean; optedOut: boolean; whatsappPermission: string };
  setup: {
    interviewerIds: string[];
    durationMins: number;
    dateFrom: string;
    dateTo: string;
    workStart: string;
    workEnd: string;
    timeZone: string;
    candidateEmail: string;
    candidatePhone: string;
    meetingMethod: string;
    locationNote: string;
  };
  interviewers: { id: string; name: string; calendar: string; manual: Row[] }[];
  candidateWindows: Row[];
  proposed: { slots: number[]; via: string | null; at: string | null };
  channels: { email: boolean; emailReason: string; whatsapp: boolean; whatsappReason: string };
  activeEvent: EventView | null;
  reschedule: boolean;
};

const SOURCE: Record<string, { label: string; tone: "ok" | "neutral" | "warn" | "danger" }> = {
  own_calendar: { label: "Live calendar", tone: "ok" },
  shared_calendar: { label: "Shared calendar", tone: "ok" },
  manual: { label: "Entered manually", tone: "neutral" },
  demo: { label: "Demo availability", tone: "warn" },
  unknown: { label: "Unknown", tone: "danger" },
};
const CAL: Record<string, string> = { connected: "Calendar connected", not_connected: "Calendar not connected", revoked: "Calendar access expired", permission_required: "Calendar permission missing", error: "Calendar error" };

export function Scheduler(p: SchedulerProps) {
  const router = useRouter();
  const toast = useToast();
  const [state, action, pending] = useServerForm(saveSchedulingSetup.bind(null, p.stageId));
  const [result, setResult] = useState<SlotResult | null>(null);
  const [finding, setFinding] = useState(false);
  const [picked, setPicked] = useState<{ start: number; end: number; unknownFor: string[] }[]>([]);
  const [review, setReview] = useState<{ start: number; end: number; unknownFor: string[] } | null>(null);
  const [ack, setAck] = useState(false);
  const [requestKey, setRequestKey] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{ text: string; via: string } | null>(null);
  const zones = useMemo(() => {
    try {
      return (Intl as unknown as { supportedValuesOf: (k: string) => string[] }).supportedValuesOf("timeZone");
    } catch {
      return [p.setup.timeZone];
    }
  }, [p.setup.timeZone]);
  const [tz, setTz] = useState(p.setup.timeZone === "UTC" ? Intl.DateTimeFormat().resolvedOptions().timeZone : p.setup.timeZone);
  useEffect(() => {
    if (state?.ok) {
      setResult(null);
      setPicked([]);
    }
  }, [state]);

  const find = async () => {
    setFinding(true);
    setErr(null);
    setPicked([]);
    setReview(null);
    const r = await findSlotsAction(p.stageId).catch(() => null);
    setFinding(false);
    if (!r) return setErr("Couldn't check availability. Try again.");
    if (r.error) setErr(r.error);
    setResult(r);
  };
  const toggle = (s: { start: number; end: number; unknownFor: string[] }) =>
    setPicked(picked.some((x) => x.start === s.start) ? picked.filter((x) => x.start !== s.start) : [...picked, s].slice(-5));
  const fmt = (t: number) => formatInZone(t, result?.timeZone ?? p.setup.timeZone, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

  return (
    <div className="space-y-5">
      {!p.live && (
        <Notice tone="warn">
          <strong>Demo mode.</strong> Google Calendar isn&apos;t connected for this workspace, so availability is sample data and scheduling saves a simulated event in Talyn only — no calendar is
          checked, no event is created and no invitations are sent.
        </Notice>
      )}
      {p.live && p.myConnection !== "connected" && (
        <Notice tone="warn">
          {p.myConnection ? `Your Google Calendar needs attention (${CAL[p.myConnection] ?? p.myConnection}).` : "Connect your Google Calendar to create the event on your calendar."} Finding times works without it, using
          interviewers&apos; own connections.{" "}
          <a href={p.connectHref} className="font-medium underline">
            {p.myConnection ? "Reconnect" : "Connect Google Calendar"}
          </a>
        </Notice>
      )}

      {p.activeEvent && (
        <section aria-labelledby="ev-h">
          <h2 id="ev-h" className="mb-2 text-[15px] font-semibold">
            Scheduled interview
          </h2>
          <EventCard e={p.activeEvent} />
          {p.reschedule ? <p className="mt-2 text-[13px] text-ink-2">Rescheduling: find new times below, pick one and confirm. Google sends updated invitations for live events.</p> : null}
        </section>
      )}

      <Card className="p-4 sm:p-5">
        <h2 className="mb-3 text-[15px] font-semibold">1 · Interview details</h2>
        <ActionForm action={action} pending={pending} className="space-y-4">
          <fieldset>
            <legend className="mb-1 text-[13px] font-medium">Interviewers</legend>
            {p.interviewers.length === 0 ? (
              <p className="text-[13px] text-warn">No interviewers are assigned to this stage yet — assign them on the plan first.</p>
            ) : (
              <div className="grid gap-1.5 sm:grid-cols-2">
                {p.interviewers.map((iv) => (
                  <label key={iv.id} className="flex items-center gap-2 rounded-lg border border-line-strong px-2.5 py-2 text-[13px]">
                    <input type="checkbox" name="interviewer" value={iv.id} defaultChecked={p.setup.interviewerIds.includes(iv.id)} />
                    <span className="font-medium">{iv.name}</span>
                    <span className={clsx("ml-auto text-[11.5px]", iv.calendar === "connected" ? "text-ok" : "text-muted")}>{p.live ? (CAL[iv.calendar] ?? iv.calendar) : "demo"}</span>
                  </label>
                ))}
              </div>
            )}
          </fieldset>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Duration (minutes)">
              <Input name="durationMins" type="number" min={15} max={480} step={15} defaultValue={p.setup.durationMins} required />
            </Field>
            <Field label="From">
              <Input name="dateFrom" type="date" defaultValue={p.setup.dateFrom} required />
            </Field>
            <Field label="To" hint="Up to three weeks.">
              <Input name="dateTo" type="date" defaultValue={p.setup.dateTo} required />
            </Field>
            <Field label="Working hours start">
              <Input name="workStart" type="time" defaultValue={p.setup.workStart} required />
            </Field>
            <Field label="Working hours end">
              <Input name="workEnd" type="time" defaultValue={p.setup.workEnd} required />
            </Field>
            <Field label="Time zone">
              <Select name="timeZone" value={tz} onChange={(e) => setTz(e.target.value)}>
                {zones.map((z) => (
                  <option key={z} value={z}>
                    {z}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
          {p.setup.timeZone === "UTC" && tz !== "UTC" && <p className="text-[12.5px] text-warn">Times currently use UTC. Save details to switch to {tz}.</p>}
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Candidate email" hint="Invited as an attendee. Talyn never guesses contact details.">
              <Input name="candidateEmail" type="email" defaultValue={p.setup.candidateEmail} maxLength={200} />
            </Field>
            <Field label="Candidate phone (optional)" hint="Only for the existing WhatsApp channel, with recorded permission.">
              <Input name="candidatePhone" defaultValue={p.setup.candidatePhone} maxLength={40} placeholder="+44…" />
            </Field>
            <Field label="Meeting method">
              <Select name="meetingMethod" defaultValue={p.setup.meetingMethod}>
                <option value="meet">Google Meet (new link for this interview)</option>
                <option value="phone">Phone</option>
                <option value="in_person">In person</option>
                <option value="other">Other</option>
              </Select>
            </Field>
            <Field label="Location or dial-in (if not Meet)">
              <Input name="locationNote" defaultValue={p.setup.locationNote} maxLength={300} />
            </Field>
          </div>
          <div className="flex items-center gap-2">
            <FormMessage state={state} />
            <SubmitButton className="ml-auto" variant="secondary" pendingLabel="Saving…">
              Save details
            </SubmitButton>
          </div>
        </ActionForm>
      </Card>

      <Card className="p-4 sm:p-5">
        <h2 className="mb-1 text-[15px] font-semibold">2 · Availability you&apos;ve been given</h2>
        <p className="mb-3 text-[12.5px] text-muted">
          For interviewers without a connected calendar, enter the times they told you they&apos;re free — otherwise their availability stays unknown (never assumed free). The candidate&apos;s calendar isn&apos;t
          accessible; enter the windows they gave you, if any. Times are in {p.setup.timeZone}.
        </p>
        <div className="space-y-3">
          {p.interviewers
            .filter((iv) => !p.live || iv.calendar !== "connected")
            .map((iv) => (
              <WindowEditor key={iv.id} stageId={p.stageId} who={iv.id} label={`${iv.name} — free times`} initial={iv.manual} />
            ))}
          <WindowEditor stageId={p.stageId} who="candidate" label={`${p.candidate.name} (candidate) — times they can do`} initial={p.candidateWindows} />
        </div>
      </Card>

      <Card className="p-4 sm:p-5">
        <div className="mb-3 flex flex-wrap items-center gap-2">
          <h2 className="text-[15px] font-semibold">3 · Find times</h2>
          <Button variant="primary" className="ml-auto" onClick={find} disabled={finding}>
            {finding ? <Spinner /> : null}
            {result ? "Check again" : "Find available times"}
          </Button>
        </div>
        {finding && <StagedProgress stages={[{ key: "fb", label: p.live ? "Checking free/busy in authorized calendars" : "Matching sample (demo) availability", state: "active" }]} />}
        {err && (
          <p role="alert" className="text-[13px] text-danger">
            {err}{" "}
            <button type="button" onClick={find} className="underline">
              Retry
            </button>
          </p>
        )}
        {result && !finding && (
          <div className="space-y-4">
            <div className="flex flex-wrap items-center gap-2 text-[12px]">
              {result.demo ? <Badge tone="warn">Demo data — not real calendars</Badge> : <Badge tone="ok">Live Google free/busy</Badge>}
              <span className="text-muted">checked {new Date(result.checkedAt).toLocaleTimeString()} · times in {result.timeZone}</span>
            </div>
            <ul className="space-y-1 text-[12.5px]">
              {result.statuses.map((s) => (
                <li key={s.id} className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">{s.name}</span>
                  <Badge tone={SOURCE[s.source]?.tone ?? "neutral"}>{SOURCE[s.source]?.label ?? s.source}</Badge>
                  <span className="text-muted">{s.detail}</span>
                </li>
              ))}
            </ul>
            <SlotList title="Everyone is available" hint="Free in every checked calendar or entered window, and within the candidate's times if you entered any." slots={result.available} picked={picked} onToggle={toggle} fmt={fmt} />
            {result.partial.length > 0 && (
              <SlotList
                title="Availability unknown for someone"
                hint="Not free for certain: the people listed have no connected calendar or entered times. Check with them before using these."
                slots={result.partial}
                picked={picked}
                onToggle={toggle}
                fmt={fmt}
                warn
              />
            )}
            {result.available.length === 0 && result.partial.length === 0 && <p className="text-[13px] text-muted">No times fit. Widen the date range or working hours, or update the availability entered above.</p>}
          </div>
        )}
      </Card>

      {picked.length > 0 && (
        <Card className="p-4 sm:p-5">
          <h2 className="mb-2 text-[15px] font-semibold">4 · Next step</h2>
          <p className="mb-3 text-[12.5px] text-muted">{picked.length} time{picked.length === 1 ? "" : "s"} selected. Nothing is sent until you confirm.</p>
          <div className="flex flex-wrap gap-2">
            <Button
              onClick={async () => {
                setBusy("preview");
                const r = await previewProposal(p.stageId, picked.map((x) => x.start)).catch(() => null);
                setBusy(null);
                if (r?.text) setProposal({ text: r.text, via: "" });
                if (r?.error) setErr(r.error);
              }}
              disabled={!!busy}
            >
              Propose {picked.length > 1 ? "these times" : "this time"} to the candidate
            </Button>
            {picked.length === 1 && (
              <Button
                variant="primary"
                onClick={() => {
                  setReview(picked[0]);
                  setAck(false);
                  setRequestKey(crypto.randomUUID());
                }}
              >
                {p.activeEvent ? "Review new time" : "Review & schedule"}
              </Button>
            )}
          </div>
          {proposal && (
            <div className="mt-3 space-y-2 rounded-lg border border-line bg-sunken/50 p-3">
              <p className="text-[12.5px] font-medium">Review the message. Nothing has been sent or recorded yet.</p>
              <textarea readOnly value={proposal.text} rows={9} className="w-full rounded-md border border-line-strong bg-surface px-2 py-1.5 text-[13px]" aria-label="Proposal text" />
              <div className="flex flex-wrap gap-2">
                <Button size="sm" onClick={() => navigator.clipboard.writeText(proposal.text).then(() => toast({ message: "Copied — not sent" }))}>
                  Copy text
                </Button>
                <ChannelButton disabled={false} reason="" label="Record as sent by me" confirmText="Record that you sent these times yourself (e.g. from your own email)?" onSend={() => proposeTimes(p.stageId, picked.map((x) => x.start), "manual")} onDone={(m) => toast({ message: m })} />
                <ChannelButton disabled={!p.channels.email} reason={p.channels.emailReason} label="Send by email" onSend={() => proposeTimes(p.stageId, picked.map((x) => x.start), "email")} onDone={(m) => toast({ message: m })} />
                <ChannelButton disabled={!p.channels.whatsapp} reason={p.channels.whatsappReason} label="Send on WhatsApp" onSend={() => proposeTimes(p.stageId, picked.map((x) => x.start), "whatsapp")} onDone={(m) => toast({ message: m })} />
              </div>
            </div>
          )}
        </Card>
      )}
      {p.proposed.at && (
        <p className="text-[12.5px] text-muted">
          Last proposed {new Date(p.proposed.at).toLocaleString()} ({p.proposed.via === "manual" ? "sent manually by the recruiter" : `via ${p.proposed.via}`}): {p.proposed.slots.map((t) => formatInZone(t, p.setup.timeZone)).join(" · ")}
        </p>
      )}

      {review && (
        <Card className="border-ink p-4 sm:p-5" role="dialog" aria-labelledby="rev-h">
          <h2 id="rev-h" className="mb-3 text-[15px] font-semibold">
            Review {p.activeEvent ? "the new time" : "before scheduling"}
          </h2>
          <dl className="grid gap-x-4 gap-y-1.5 text-[13px] sm:grid-cols-[160px_1fr]">
            <dt className="text-muted">When</dt>
            <dd className="font-medium">
              {formatInZone(review.start, p.setup.timeZone, { weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })} – {formatInZone(review.end, p.setup.timeZone, { hour: "numeric", minute: "2-digit" })}
            </dd>
            <dt className="text-muted">Time zone</dt>
            <dd>{p.setup.timeZone}</dd>
            <dt className="text-muted">Duration</dt>
            <dd>{p.setup.durationMins} minutes</dd>
            <dt className="text-muted">Stage</dt>
            <dd>
              {p.stageName} · {p.roleTitle}
            </dd>
            <dt className="text-muted">Candidate</dt>
            <dd>
              {p.candidate.name} {p.setup.candidateEmail ? `· ${p.setup.candidateEmail}` : <span className="text-danger">· no email — add it in step 1</span>}
            </dd>
            <dt className="text-muted">Interviewers</dt>
            <dd>{p.interviewers.filter((iv) => p.setup.interviewerIds.includes(iv.id)).map((iv) => iv.name).join(", ")}</dd>
            <dt className="text-muted">Meeting</dt>
            <dd>{p.setup.meetingMethod === "meet" ? "Google Meet — a new link for this interview" : p.setup.locationNote || p.setup.meetingMethod.replace("_", " ")}</dd>
            <dt className="text-muted">What happens</dt>
            <dd>
              {p.live
                ? p.activeEvent
                  ? "Talyn rechecks free/busy, moves the Google Calendar event, and Google sends updated invitations."
                  : "Talyn rechecks free/busy, creates one event on your Google Calendar, and Google sends invitations to the candidate and interviewers."
                : "Demo: a simulated event is saved in Talyn. No calendar event, invitations or messages."}
            </dd>
          </dl>
          {review.unknownFor.length > 0 && (
            <label className="mt-3 flex items-start gap-2 rounded-lg bg-warn-soft p-2.5 text-[13px] text-warn">
              <input type="checkbox" checked={ack} onChange={(e) => setAck(e.target.checked)} className="mt-0.5" />
              <span>Availability is unknown for {review.unknownFor.join(", ")}. I&apos;ve confirmed they can make this time.</span>
            </label>
          )}
          {p.candidate.isSample && p.live && <p className="mt-2 text-[12.5px] text-danger">Sample candidates can&apos;t be invited to live calendar events.</p>}
          {err && <p className="mt-2 text-[13px] text-danger">{err}</p>}
          <div className="mt-4 flex flex-wrap gap-2">
            <Button
              variant="primary"
              disabled={!!busy || (review.unknownFor.length > 0 && !ack)}
              onClick={async () => {
                setBusy("schedule");
                setErr(null);
                const r = p.activeEvent
                  ? await rescheduleInterview(p.activeEvent.id, review.start).catch((): { error?: string; message?: string } => ({ error: "The request failed. Try again — it won't create a duplicate." }))
                  : await scheduleInterview(p.stageId, { start: review.start, requestKey, acceptUnknown: ack }).catch((): { error?: string; message?: string } => ({ error: "The request failed. Try again — retrying won't create a duplicate event." }));
                setBusy(null);
                if (r?.error) return setErr(r.error);
                toast({ message: r?.message ?? "Scheduled" });
                setReview(null);
                setPicked([]);
                setResult(null);
                router.refresh();
              }}
            >
              {busy === "schedule" ? <Spinner /> : null}
              {p.activeEvent ? "Reschedule interview" : "Schedule interview"}
            </Button>
            <Button variant="ghost" onClick={() => setReview(null)} disabled={!!busy}>
              Back
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

function SlotList({ title, hint, slots, picked, onToggle, fmt, warn }: { title: string; hint: string; slots: { start: number; end: number; unknownFor: string[] }[]; picked: { start: number }[]; onToggle: (s: { start: number; end: number; unknownFor: string[] }) => void; fmt: (t: number) => string; warn?: boolean }) {
  return (
    <div>
      <div className={clsx("text-[13px] font-medium", warn && "text-warn")}>
        {title} <span className="font-normal text-muted">· {slots.length}</span>
      </div>
      <p className="mb-1.5 text-[12px] text-muted">{hint}</p>
      {slots.length === 0 ? (
        <p className="text-[12.5px] text-faint">None in this range.</p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {slots.map((s) => {
            const on = picked.some((x) => x.start === s.start);
            return (
              <li key={s.start}>
                <button
                  type="button"
                  aria-pressed={on}
                  onClick={() => onToggle(s)}
                  title={s.unknownFor.length ? `Unknown for ${s.unknownFor.join(", ")}` : undefined}
                  className={clsx("rounded-lg border px-2.5 py-1 text-[12.5px]", on ? "border-ink bg-ink text-white" : warn ? "border-dashed border-warn/60 hover:bg-warn-soft" : "border-line-strong hover:bg-sunken")}
                >
                  {fmt(s.start)}
                  {s.unknownFor.length > 0 && <span className={on ? "text-white/70" : "text-warn"}> · ? {s.unknownFor.length}</span>}
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function ChannelButton({ disabled, reason, label, onSend, onDone, confirmText }: { disabled: boolean; reason: string; label: string; onSend: () => Promise<{ ok?: boolean; error?: string; message?: string } | undefined>; onDone: (m: string) => void; confirmText?: string }) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  return (
    <span className="inline-flex flex-col">
      <Button
        size="sm"
        disabled={disabled || busy}
        title={disabled ? reason : undefined}
        onClick={async () => {
          if (!window.confirm(confirmText ?? `${label}? The candidate receives these proposed times.`)) return;
          setBusy(true);
          const r = await onSend().catch((): { error?: string; message?: string } => ({ error: "The request failed. Nothing was sent." }));
          setBusy(false);
          if (r?.error) return setErr(r.error);
          onDone(r?.message ?? "Sent");
          router.refresh();
        }}
      >
        {busy ? <Spinner /> : null}
        {label}
      </Button>
      {disabled && <span className="mt-0.5 text-[11px] text-faint">{reason}</span>}
      {err && <span className="mt-0.5 text-[11.5px] text-danger">{err}</span>}
    </span>
  );
}

/** Rows of date + start + end, saved as availability for one person. */
function WindowEditor({ stageId, who, label, initial }: { stageId: string; who: string; label: string; initial: Row[] }) {
  const [rows, setRows] = useState<Row[]>(initial);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const router = useRouter();
  const set = (i: number, k: keyof Row, v: string) => setRows(rows.map((r, j) => (j === i ? { ...r, [k]: v } : r)));
  return (
    <div className="rounded-lg border border-line p-3">
      <div className="mb-1.5 text-[13px] font-medium">{label}</div>
      {rows.length === 0 && <p className="mb-1.5 text-[12px] text-faint">None entered — {who === "candidate" ? "any time in working hours is considered" : "availability unknown"}.</p>}
      <ul className="space-y-1.5">
        {rows.map((r, i) => (
          <li key={i} className="flex flex-wrap items-center gap-1.5">
            <Input type="date" value={r.date} onChange={(e) => set(i, "date", e.target.value)} className="h-8 w-40 text-[12.5px]" aria-label="Date" />
            <Input type="time" value={r.start} onChange={(e) => set(i, "start", e.target.value)} className="h-8 w-28 text-[12.5px]" aria-label="From" />
            <span className="text-muted">–</span>
            <Input type="time" value={r.end} onChange={(e) => set(i, "end", e.target.value)} className="h-8 w-28 text-[12.5px]" aria-label="To" />
            <button type="button" onClick={() => setRows(rows.filter((_, j) => j !== i))} className="text-[12px] text-muted underline">
              Remove
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" onClick={() => setRows([...rows, { date: rows[rows.length - 1]?.date ?? "", start: "09:00", end: "12:00" }])}>
          + Add window
        </Button>
        <Button
          size="sm"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            const r = await saveWindows(stageId, who, rows).catch(() => ({ error: "Couldn't save." }));
            setBusy(false);
            setMsg(r?.error ?? "Saved");
            router.refresh();
          }}
        >
          Save
        </Button>
        {msg && <span className={clsx("text-[12px]", msg === "Saved" ? "text-ok" : "text-danger")}>{msg}</span>}
      </div>
    </div>
  );
}
