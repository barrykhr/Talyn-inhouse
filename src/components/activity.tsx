import { AUDIT_LABEL } from "@/lib/audit";

export type ActivityRow = { id: string; action: string; actorName: string; createdAt: Date; meta: Record<string, unknown> };

const DETAIL: Record<string, (m: Record<string, unknown>) => string | null> = {
  "stage.changed": (m) => `${m.from} → ${m.to}`.replace(/_/g, " "),
  "decision.recorded": (m) => String(m.decision ?? ""),
  "assessment.run": (m) => [m.generator === "ai" ? `AI (${m.model})` : "keyword check", m.criteriaVersion ? `criteria v${m.criteriaVersion}` : null, m.score != null ? `score ${m.score}` : "score withheld"].filter(Boolean).join(" · "),
  "recommendation.reviewed": (m) => `${m.status}`,
  "task.resolved": (m) => `${m.status}`,
  "export.pipeline": (m) => `${m.rows} rows`,
  "export.candidates": (m) => `${m.rows} rows`,
  "criteria.changed": (m) => `${m.change} · now v${m.version}`,
};

/** Read-only audit trail. Contains ids, counts and enum values only — no candidate personal data. */
export function ActivityList({ rows, showSubject = false }: { rows: (ActivityRow & { subject?: string })[]; showSubject?: boolean }) {
  if (!rows.length) return <p className="text-[13px] text-faint">No recorded activity yet.</p>;
  return (
    <ol className="space-y-1.5 text-[13px]">
      {rows.map((r) => {
        const detail = DETAIL[r.action]?.(r.meta);
        return (
          <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
            <span className="text-ink-2">{AUDIT_LABEL[r.action] ?? r.action}</span>
            {detail && <span className="text-muted">· {detail}</span>}
            {showSubject && r.subject && <span className="text-muted">· {r.subject}</span>}
            <span className="ml-auto text-[12px] text-faint">
              {r.actorName || "System"} · {r.createdAt.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

export function parseMeta(json: string): Record<string, unknown> {
  try {
    return JSON.parse(json) as Record<string, unknown>;
  } catch {
    return {};
  }
}
