"use client";

import { useState } from "react";
import { Spinner } from "@/components/client";
import { useToast } from "@/components/toast";
import { buttonClass, Input, Textarea } from "@/components/ui";
import { sendInterestCheck } from "@/server/interest-actions";
import { useRouter } from "next/navigation";

const ANSWER: Record<string, string> = { not_now: "Said not right now", declined: "Said no thanks" };

/** Ask a found candidate whether they're interested, with a one-click link. They reach the hiring manager only after a yes. */
export function InterestAsk({ applicationId, emailReady, last }: { applicationId: string; emailReady: boolean; last: { createdAt: string; sentVia: string; response: string | null } | null }) {
  const [open, setOpen] = useState(false);
  const [line, setLine] = useState("");
  const [busy, setBusy] = useState<"email" | "manual" | null>(null);
  const [text, setText] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const toast = useToast();
  const router = useRouter();
  const run = async (channel: "email" | "manual") => {
    setBusy(channel);
    setErr(null);
    const r = await sendInterestCheck(applicationId, channel, line).catch(() => ({ error: "Something went wrong. Try again." }) as { error: string; text?: string });
    setBusy(null);
    if ("error" in r) {
      setErr(r.error);
      if (r.text) setText(r.text);
      return;
    }
    setText(r.text);
    if (channel === "manual") void navigator.clipboard?.writeText(r.text).catch(() => {});
    toast({ message: r.message });
    router.refresh();
  };
  const status = last?.response ? ANSWER[last.response] : last ? `Asked ${new Date(last.createdAt).toLocaleDateString("en-GB", { day: "numeric", month: "short" })}${last.sentVia === "manual" ? " (sent by you)" : " by email"} · waiting` : "Not asked about interest yet";
  return (
    <div className="text-[12px]">
      <p className="text-muted">{status}</p>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="font-medium text-brand hover:underline">
          {last ? "Ask again →" : "Ask about interest →"}
        </button>
      ) : (
        <div className="motion-fade mt-1 w-[300px] max-w-full space-y-2 rounded-lg border border-line bg-surface p-2.5">
          <label className="block">
            <span className="text-[12px] font-medium">Your own line (optional)</span>
            <Input value={line} onChange={(e) => setLine(e.target.value)} maxLength={240} placeholder="e.g. Your Kafka work at Helio caught my eye." className="mt-1 h-8 text-[12.5px]" />
          </label>
          <div className="flex flex-wrap gap-1.5">
            {emailReady && (
              <button type="button" disabled={!!busy} onClick={() => run("email")} className={buttonClass("primary", "sm")}>
                {busy === "email" && <Spinner />} Send by email
              </button>
            )}
            <button type="button" disabled={!!busy} onClick={() => run("manual")} className={buttonClass(emailReady ? "secondary" : "primary", "sm")}>
              {busy === "manual" && <Spinner />} Copy message with link
            </button>
            <button type="button" onClick={() => setOpen(false)} className={buttonClass("ghost", "sm")}>
              Close
            </button>
          </div>
          {err && <p className="text-danger">{err}</p>}
          {text && <Textarea readOnly rows={7} value={text} className="text-[12px]" aria-label="Message" />}
          <p className="text-faint">They reach the hiring manager only after they say yes.</p>
        </div>
      )}
    </div>
  );
}
