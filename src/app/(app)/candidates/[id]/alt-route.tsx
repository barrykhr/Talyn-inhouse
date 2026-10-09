"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Button, Input, Select } from "@/components/ui";
import { setAltRoute } from "@/server/scoring-actions";

const LABEL: Record<string, string> = { none: "Not in use", requested: "Requested", in_progress: "In progress", completed: "Completed" };

/** Records an alternative assessment route. Never asks for the reason (e.g. disability). */
export function AltRouteControl({ applicationId, status, note, by, at, accommodationText }: { applicationId: string; status: string; note: string | null; by: string | null; at: string | null; accommodationText: string }) {
  const [value, setValue] = useState(status);
  const [text, setText] = useState(note ?? "");
  const [msg, setMsg] = useState<string | null>(null);
  const router = useRouter();
  return (
    <div className="space-y-1.5 text-[12.5px]">
      <div className="text-[11.5px] font-semibold uppercase tracking-wide text-muted">Alternative assessment</div>
      <p className="text-[11.5px] text-faint">
        For a candidate who asks for another way to be assessed, or whom this screen may not assess accurately. While in use, the screening score isn&apos;t shown or used. Don&apos;t record
        why (e.g. health or disability).
      </p>
      {accommodationText && <p className="rounded-md bg-sunken px-2 py-1 text-[11.5px] text-ink-2">How candidates can ask: {accommodationText}</p>}
      <div className="flex flex-wrap gap-1.5">
        <Select value={value} onChange={(e) => setValue(e.target.value)} className="h-8 w-auto text-[12.5px]" aria-label="Alternative assessment status">
          {Object.entries(LABEL).map(([k, l]) => (
            <option key={k} value={k}>
              {l}
            </option>
          ))}
        </Select>
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="What will be done instead (optional)" className="h-8 min-w-40 flex-1 text-[12.5px]" maxLength={300} aria-label="Alternative route note" />
        <Button
          size="sm"
          disabled={value === status && text === (note ?? "")}
          onClick={async () => {
            const r = await setAltRoute(applicationId, value, text).catch(() => ({ error: "Couldn't save." }));
            setMsg(r?.error ?? "Saved");
            router.refresh();
          }}
        >
          Save
        </Button>
      </div>
      {at && status !== "none" && (
        <p className="text-[11.5px] text-faint">
          {LABEL[status]} · {by} · {new Date(at).toLocaleDateString()}
        </p>
      )}
      {msg && <p className="text-[11.5px] text-muted">{msg}</p>}
    </div>
  );
}
