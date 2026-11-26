import clsx from "clsx";
import { ActionButton } from "@/components/client";
import { Card, SectionTitle } from "@/components/ui";
import { TIMING_BAND_LABEL, type TimingBand, type TimingSignal } from "@/lib/timing";

const RING: Record<TimingBand, string> = { good: "border-ok text-ok", some: "border-warn text-warn", low: "border-line-strong text-muted", unknown: "border-line text-faint" };

/** Score ring used on cards: "74 · Good time to reach out". */
export function TimingChip({ score, band, compact = false }: { score: number | null; band: TimingBand; compact?: boolean }) {
  if (score === null) return null;
  return (
    <span className="inline-flex items-center gap-1.5" title="Timing: an ordering aid for outreach from tenure, company news and profile changes. Not a measure of interest or fit.">
      <span className={clsx("flex h-7 w-7 items-center justify-center rounded-full border-2 text-[11px] font-semibold tabular-nums", RING[band])}>{score}</span>
      {!compact && <span className="text-[12px] text-ink-2">{TIMING_BAND_LABEL[band]}</span>}
    </span>
  );
}

/**
 * Timing for one candidate: the score and every signal behind it, with its source. Recruiters use
 * it to decide when to reach out; it never decides, hides or ranks anyone.
 */
export function TimingCard({
  t,
  checkNews,
  anchorId,
}: {
  anchorId?: string;
  t: { score: number | null; band: TimingBand; signals: TimingSignal[]; company: string | null; events: { checkedAt: Date; stale: boolean } | null };
  checkNews?: () => Promise<unknown>;
}) {
  return (
    <Card className="p-4" id={anchorId}>
      <SectionTitle
        hint="When to reach out, from facts with sources: time in role, company news, profile changes and what they've said. Not a measure of interest or fit."
        action={
          checkNews && t.company ? (
            <ActionButton action={checkNews} pendingLabel="Checking the news…">
              {t.events ? (t.events.stale ? "Check news again" : "Refresh news") : `Check ${t.company} news`}
            </ActionButton>
          ) : undefined
        }
      >
        Timing
      </SectionTitle>
      <div className="flex items-center gap-3">
        <span className={clsx("flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-[3px] text-[18px] font-semibold tabular-nums", RING[t.band])}>{t.score ?? "–"}</span>
        <div>
          <p className="text-[14px] font-semibold">{TIMING_BAND_LABEL[t.band]}</p>
          <p className="text-[12px] text-muted">
            {t.company ? `Company news ${t.events ? `checked ${t.events.checkedAt.toLocaleDateString("en-GB", { day: "numeric", month: "short" })}` : "not checked yet"}` : "No current employer on file"}
          </p>
        </div>
      </div>
      {t.signals.length > 0 && (
        <ul className="mt-3 divide-y divide-line rounded-lg border border-line">
          {t.signals.map((s, i) => (
            <li key={i} className="flex items-start gap-3 px-3 py-2 text-[13px]">
              <span className={clsx("w-9 shrink-0 text-right font-semibold tabular-nums", s.points > 0 ? "text-ok" : s.points < 0 ? "text-danger" : "text-faint")}>{s.points > 0 ? `+${s.points}` : s.points}</span>
              <span className="min-w-0 flex-1">
                <span className="font-medium">{s.label}</span>
                <span className="block text-[12.5px] text-ink-2">{s.detail}</span>
                <span className="block text-[11.5px] text-faint">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="hover:underline">
                      {s.source} ↗
                    </a>
                  ) : (
                    s.source
                  )}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="mt-2 text-[11.5px] text-faint">Start 30, add or subtract each signal, 0–100. Only time in the current title is used, never total experience or age.</p>
    </Card>
  );
}
