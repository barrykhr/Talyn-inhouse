"use client";

import { ActionButton } from "@/components/client";
import { Card } from "@/components/ui";
import { resolveConflict } from "@/server/ats-actions";

export type ConflictView = { id: string; field: string; label: string; talynValue: string; atsValue: string; ownership: string };

/** ATS sync found a different value where Talyn has a value a person entered or confirmed. */
export function AtsConflictsCard({ conflicts, atsLabel }: { conflicts: ConflictView[]; atsLabel: string }) {
  return (
    <Card id="ats-conflicts" className="mb-6 scroll-mt-6 border-warn/40 p-4">
      <div className="text-[13.5px] font-medium">
        {conflicts.length} field{conflicts.length === 1 ? "" : "s"} differ{conflicts.length === 1 ? "s" : ""} from {atsLabel}
      </div>
      <p className="text-[12.5px] text-muted">Talyn didn&apos;t overwrite these. Choose which value to keep.</p>
      <ul className="mt-2 divide-y divide-line text-[13px]">
        {conflicts.map((c) => (
          <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <div className="min-w-0">
              <div className="font-medium">{c.label}</div>
              <div className="text-ink-2">
                Talyn: <span className="font-medium">{c.talynValue}</span> · ATS: <span className="font-medium">{c.atsValue}</span>
              </div>
              <div className="text-[11.5px] text-faint">{c.ownership === "ats" ? "Usually owned by the ATS" : "Recruiter's choice"}</div>
            </div>
            <span className="flex gap-1">
              <ActionButton action={() => resolveConflict(c.id, "kept_talyn")} successMessage="Kept Talyn's value">
                Keep Talyn value
              </ActionButton>
              <ActionButton action={() => resolveConflict(c.id, "used_ats")} successMessage="Using the ATS value">
                Use ATS value
              </ActionButton>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}
