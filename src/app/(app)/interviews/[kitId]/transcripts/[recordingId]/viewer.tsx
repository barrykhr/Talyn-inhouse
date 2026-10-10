"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner } from "@/components/client";
import { useToast } from "@/components/toast";
import { Button, Input, Select, Textarea } from "@/components/ui";
import { analyzeRecording, deleteRecording, editSegment, reviewInsight, setSpeaker, addEvidenceToScorecard } from "@/server/transcript-actions";

type R = { error?: string; message?: string; redirectTo?: string } | undefined;
function useRun() {
  const router = useRouter();
  const toast = useToast();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const run = async (key: string, fn: () => Promise<R>) => {
    setBusy(key);
    setError(null);
    const r: R = await fn().catch(() => ({ error: "Something went wrong. Try again." }));
    setBusy(null);
    if (r?.error) return setError(r.error);
    if (r?.redirectTo) return window.location.assign(r.redirectTo);
    if (r?.message) toast({ message: r.message });
    router.refresh();
  };
  return { busy, error, run };
}

export type SegView = { id: string; idx: number; at: string; speaker: string; role: string; text: string; original: string; editedBy: string | null; editedAt: string | null };

export function SegmentRow({ s }: { s: SegView }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(s.text);
  const [speaker, setSpk] = useState(s.speaker);
  const { busy, error, run } = useRun();
  return (
    <li id={`seg-${s.id}`} className="group scroll-mt-24 rounded-md px-2 py-1.5 target:bg-brand-soft target:ring-1 target:ring-brand/40">
      <div className="flex items-baseline gap-2 text-[12px]">
        <a href={`#seg-${s.id}`} className="font-mono tabular-nums text-muted hover:text-ink" title="Link to this passage">
          {s.at}
        </a>
        <span className={clsx("font-semibold", s.role === "candidate" ? "text-brand" : s.role === "interviewer" ? "text-ink-2" : "text-muted")}>{s.speaker}</span>
        {s.role !== "unknown" && <span className="text-faint">{s.role}</span>}
        {s.editedBy && (
          <span className="text-warn" title={`Original: ${s.original}`}>
            · corrected by {s.editedBy}
          </span>
        )}
        {!editing && (
          <button type="button" onClick={() => setEditing(true)} className="ml-auto text-[11.5px] text-faint opacity-0 hover:text-ink group-hover:opacity-100 focus:opacity-100">
            Correct
          </button>
        )}
      </div>
      {editing ? (
        <div className="mt-1 space-y-1.5">
          <Input value={speaker} onChange={(e) => setSpk(e.target.value)} className="h-7 text-[12px]" aria-label="Speaker" />
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="text-[13px]" aria-label="Passage text" />
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" disabled={!!busy} onClick={() => run("save", () => editSegment(s.id, text, speaker)).then(() => setEditing(false))}>
              {busy ? "Saving…" : "Save correction"}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
          {error && <p className="text-[12px] text-danger">{error}</p>}
        </div>
      ) : (
        <p className="text-[13.5px] leading-relaxed text-ink">{s.text}</p>
      )}
    </li>
  );
}

export function SpeakerRow({ recordingId, label, role, count, setBy }: { recordingId: string; label: string; role: string; count: number; setBy: string | null }) {
  const [r, setR] = useState(role);
  const [name, setName] = useState("");
  const { busy, error, run } = useRun();
  return (
    <div className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
      <span className="min-w-28 font-medium">{label}</span>
      <span className="text-faint">{count} passages</span>
      <Select value={r} onChange={(e) => setR(e.target.value)} className="h-7 max-w-36 text-[12px]" aria-label={`Who is ${label}`}>
        <option value="unknown">Not sure</option>
        <option value="interviewer">Interviewer</option>
        <option value="candidate">Candidate</option>
      </Select>
      <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Rename (optional)" className="h-7 max-w-40 text-[12px]" />
      <Button size="sm" variant="secondary" disabled={!!busy || (r === role && !name.trim())} onClick={() => run("spk", () => setSpeaker(recordingId, label, r, name))}>
        {busy ? "Saving…" : "Apply"}
      </Button>
      <span className="text-[11.5px] text-faint">{setBy ? `set by ${setBy}` : "from the source file"}</span>
      {error && <span className="text-[12px] text-danger">{error}</span>}
    </div>
  );
}

export type InsightView = {
  id: string;
  kind: string;
  competencyName: string | null;
  coverage: string | null;
  text: string;
  editedText: string | null;
  quote: string | null;
  refs: { id: string; at: string }[];
  status: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  usedBy: string | null;
};

const COVERAGE_LABEL: Record<string, string> = { discussed: "Discussed", not_discussed: "Not discussed", unclear: "Unclear" };

export function InsightCard({ i, canUseInScorecard }: { i: InsightView; canUseInScorecard: boolean }) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState(i.editedText ?? i.text);
  const { busy, error, run } = useRun();
  const shown = i.editedText ?? i.text;
  return (
    <div className={clsx("rounded-lg border px-3 py-2 text-[13px]", i.status === "dismissed" ? "border-line opacity-60" : i.status === "suggested" ? "border-dashed border-brand/40" : "border-line")}>
      <div className="mb-1 flex flex-wrap items-center gap-1.5 text-[11.5px]">
        <span className={clsx("rounded px-1 font-semibold uppercase tracking-wide", i.status === "suggested" ? "bg-brand-soft text-brand" : "bg-sunken text-ink-2")}>
          {i.status === "suggested" ? "AI suggestion" : i.status === "dismissed" ? "Dismissed" : i.status === "edited" ? "Edited by a person" : "Accepted by a person"}
        </span>
        {i.competencyName && <span className="font-medium text-ink-2">{i.competencyName}</span>}
        {i.coverage && (
          <span className={clsx("rounded px-1", i.coverage === "discussed" ? "bg-ok-soft text-ok" : i.coverage === "unclear" ? "bg-warn-soft text-warn" : "bg-sunken text-muted")}>
            {i.coverage === "discussed" ? "✓ " : i.coverage === "unclear" ? "? " : "– "}
            {COVERAGE_LABEL[i.coverage]}
          </span>
        )}
        {i.reviewedBy && <span className="text-faint">· {i.reviewedBy}, {i.reviewedAt && new Date(i.reviewedAt).toLocaleDateString()}</span>}
      </div>
      {i.quote && <p className="quote mb-1 border-l-2 border-ok pl-2 text-ink">“{i.quote}”</p>}
      {editing ? (
        <div className="space-y-1.5">
          <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} className="text-[13px]" />
          <div className="flex gap-1.5">
            <Button size="sm" variant="primary" disabled={!!busy} onClick={() => run("edit", () => reviewInsight(i.id, "edit", text)).then(() => setEditing(false))}>
              Save
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <p className="text-ink-2">{shown}</p>
      )}
      <div className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
        {i.refs.length ? (
          <span className="text-muted">
            Passages:{" "}
            {i.refs.map((r, n) => (
              <a key={r.id} href={`#seg-${r.id}`} className="font-mono text-brand hover:underline">
                {r.at}
                {n < i.refs.length - 1 ? ", " : ""}
              </a>
            ))}
          </span>
        ) : (
          <span className="text-faint">No passage cited</span>
        )}
        {!editing && (
          <span className="ml-auto flex flex-wrap gap-1">
            {i.status !== "accepted" && i.status !== "dismissed" && (
              <Button size="sm" variant="secondary" disabled={!!busy} onClick={() => run("acc", () => reviewInsight(i.id, "accept"))}>
                Accept
              </Button>
            )}
            {i.status !== "dismissed" && (
              <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
                Edit
              </Button>
            )}
            {i.status !== "dismissed" ? (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("dis", () => reviewInsight(i.id, "dismiss"))}>
                Dismiss
              </Button>
            ) : (
              <Button size="sm" variant="ghost" disabled={!!busy} onClick={() => run("reset", () => reviewInsight(i.id, "reset"))}>
                Restore
              </Button>
            )}
            {i.kind === "evidence" && canUseInScorecard && (i.status === "accepted" || i.status === "edited") && (
              <Button size="sm" variant="primary" disabled={!!busy || !!i.usedBy} onClick={() => run("use", () => addEvidenceToScorecard(i.id))} title="Copies it into your draft scorecard as evidence. You still rate and submit.">
                {i.usedBy ? "Added to scorecard" : "Add to my draft scorecard"}
              </Button>
            )}
          </span>
        )}
      </div>
      {error && <p className="mt-1 text-[12px] text-danger">{error}</p>}
    </div>
  );
}

export function AnalyzeButton({ recordingId, again, aiOn }: { recordingId: string; again: boolean; aiOn: boolean }) {
  const { busy, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end">
      <Button size="sm" variant="primary" disabled={!!busy || !aiOn} title={aiOn ? undefined : "AI is off"} onClick={() => run("an", () => analyzeRecording(recordingId))}>
        {busy && <Spinner />}
        {busy ? "Reading the transcript…" : again ? "Re-run analysis" : "Analyse with AI"}
      </Button>
      {error && <span className="mt-1 text-[12px] text-danger">{error}</span>}
    </span>
  );
}

export function DeleteRecordingButton({ recordingId }: { recordingId: string }) {
  const { busy, error, run } = useRun();
  return (
    <span className="inline-flex flex-col items-end">
      <Button
        size="sm"
        variant="danger"
        disabled={!!busy}
        onClick={() => {
          if (window.confirm("Delete this transcript, its corrections and all suggestions? This can't be undone.")) run("del", () => deleteRecording(recordingId));
        }}
      >
        {busy ? "Deleting…" : "Delete transcript"}
      </Button>
      {error && <span className="mt-1 text-[12px] text-danger">{error}</span>}
    </span>
  );
}
