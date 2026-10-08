import type { Summary } from "@/lib/summary";

/** Compact, explainable summary: "Essential 3/4 supported · 1 partial". */
export function SummaryLine({ summary, compact = false }: { summary: Summary; compact?: boolean }) {
  const part = (label: string, b: Summary["essential"]) =>
    b.total === 0 ? null : (
      <span className="whitespace-nowrap">
        <span className="text-muted">{label}</span> <span className="font-medium text-ok">{b.supported}</span>
        <span className="text-faint">/{b.total} supported</span>
        {!compact && b.partially_supported > 0 && <span className="text-warn"> · {b.partially_supported} partial</span>}
        {!compact && b.inferred > 0 && <span className="text-warn"> · {b.inferred} inferred</span>}
        {!compact && b.conflicting > 0 && <span className="text-danger"> · {b.conflicting} conflicting</span>}
        {!compact && b.not_stated > 0 && <span className="text-gap"> · {b.not_stated} not stated</span>}
      </span>
    );
  return (
    <span className="inline-flex flex-wrap gap-x-3 gap-y-0.5 text-[12.5px]">
      {part("Essential", summary.essential)}
      {part("Preferred", summary.preferred)}
    </span>
  );
}
