import clsx from "clsx";
import { HEALTH_BAND_LABEL, HEALTH_HELP, type HealthBand } from "@/lib/health";

const CLS: Record<HealthBand, string> = {
  healthy: "bg-ok-soft text-ok border-ok/30",
  watch: "bg-warn-soft text-warn border-warn/30",
  at_risk: "bg-danger-soft text-danger border-danger/30",
};

/** Health band and score. Label and number, never colour alone. */
export function HealthPill({ score, band, className, title }: { score: number; band: HealthBand; className?: string; title?: string }) {
  return (
    <span className={clsx("inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11.5px] font-semibold", CLS[band], className)} title={title ?? HEALTH_HELP}>
      {HEALTH_BAND_LABEL[band]} <span className="tabular-nums font-medium">{score}</span>
    </span>
  );
}
