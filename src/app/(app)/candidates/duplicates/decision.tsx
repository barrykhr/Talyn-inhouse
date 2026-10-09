"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input } from "@/components/ui";
import { reviewDuplicate } from "@/server/duplicate-actions";

export function DuplicateDecision({ id, status }: { id: string; status: string }) {
  const [note, setNote] = useState("");
  const [pending, setPending] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  const act = async (s: string) => {
    setPending(s);
    const r = await reviewDuplicate(id, s, note).catch(() => ({ error: "Couldn't save." }));
    setPending(null);
    setMsg(r?.error ?? null);
    if (!r?.error) router.refresh();
  };
  if (status !== "open")
    return (
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="ghost" disabled={!!pending} onClick={() => act("open")}>
          {pending ? "Undoing…" : "Undo decision"}
        </Button>
        {msg && <span className="text-[12px] text-danger">{msg}</span>}
      </div>
    );
  return (
    <div className="space-y-2">
      <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Note (optional): what you checked" className="h-8 text-[12.5px]" aria-label="Decision note" maxLength={500} />
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="primary" disabled={!!pending} onClick={() => act("linked")} title="Both records are kept; they're shown as the same person.">
          {pending === "linked" ? "Saving…" : "Same person — link"}
        </Button>
        <Button size="sm" disabled={!!pending} onClick={() => act("dismissed")}>
          {pending === "dismissed" ? "Saving…" : "Different people"}
        </Button>
        <Button size="sm" variant="ghost" disabled={!!pending} onClick={() => act("deferred")}>
          {pending === "deferred" ? "Saving…" : "Decide later"}
        </Button>
      </div>
      {msg && <p className="text-[12px] text-danger">{msg}</p>}
    </div>
  );
}
