"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { ActionForm, FormMessage, Spinner, SubmitButton, useServerForm } from "@/components/client";
import { buttonClass, Input } from "@/components/ui";
import { VERDICT_LABEL, type Verdict } from "@/lib/loop/calibration";
import { startCalibration, voteCalibration } from "@/server/calibration-actions";

type Option = { value: string; name: string; headline: string; note: string };

/** Pick 3–8 profiles for the hiring manager to react to. */
export function StartRound({ roleId, options }: { roleId: string; options: Option[] }) {
  const [state, action, pending] = useServerForm(startCalibration.bind(null, roleId));
  const [picked, setPicked] = useState<Set<string>>(new Set(options.slice(0, 6).map((o) => o.value)));
  const toggle = (v: string) => setPicked((s) => (s.has(v) ? (s.delete(v), new Set(s)) : s.size >= 8 ? s : new Set(s).add(v)));
  return (
    <ActionForm action={action} pending={pending} className="space-y-3">
      <ul className="divide-y divide-line rounded-xl border border-line">
        {options.map((o) => (
          <li key={o.value}>
            <label className="flex cursor-pointer items-start gap-3 px-3 py-2 text-[13px] hover:bg-sunken/60">
              <input type="checkbox" name="pick" value={o.value} checked={picked.has(o.value)} onChange={() => toggle(o.value)} className="mt-1" />
              <span className="min-w-0 flex-1">
                <span className="font-medium">{o.name}</span>
                {o.headline && <span className="text-muted"> · {o.headline}</span>}
                <span className="block text-[12px] text-faint">{o.note}</span>
              </span>
            </label>
          </li>
        ))}
      </ul>
      <p className="text-[12.5px] text-muted">{picked.size} picked (3–8). A mix of strong and borderline profiles teaches the most.</p>
      <FormMessage state={state} />
      <SubmitButton pendingLabel="Starting…">Start calibration</SubmitButton>
    </ActionForm>
  );
}

/** One person's reaction to a profile, with the reason that makes it useful. */
export function VoteBox({ itemId, mine }: { itemId: string; mine: { verdict: Verdict; reason: string } | null }) {
  const [verdict, setVerdict] = useState<Verdict | null>(mine?.verdict ?? null);
  const [reason, setReason] = useState(mine?.reason ?? "");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(!!mine);
  const router = useRouter();
  const save = async (v: Verdict) => {
    setVerdict(v);
    setBusy(true);
    setErr(null);
    const r = await voteCalibration(itemId, v, reason).catch(() => ({ error: "Couldn't save. Try again." }));
    setBusy(false);
    if (r?.error) {
      setErr(r.error);
      setSaved(false);
    } else {
      setSaved(true);
      router.refresh();
    }
  };
  return (
    <div className="space-y-2">
      <Input value={reason} onChange={(e) => (setReason(e.target.value), setSaved(false))} maxLength={400} placeholder="Why? e.g. Has run Kafka at scale, but only as a user, not an owner" aria-label="Your reason" />
      <div className="flex flex-wrap items-center gap-1.5">
        {(["yes", "no", "unsure"] as const).map((v) => (
          <button
            key={v}
            type="button"
            disabled={busy}
            onClick={() => save(v)}
            aria-pressed={verdict === v}
            className={clsx(buttonClass(verdict === v ? "primary" : "secondary", "sm"), verdict === v && v === "no" && "!bg-danger")}
          >
            {VERDICT_LABEL[v]}
          </button>
        ))}
        {busy && <Spinner />}
        {saved && !busy && <span className="text-[12px] text-ok">Saved</span>}
      </div>
      {err && <p className="text-[12px] text-danger">{err}</p>}
    </div>
  );
}
