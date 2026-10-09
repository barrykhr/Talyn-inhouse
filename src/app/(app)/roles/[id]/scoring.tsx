"use client";

import { useEffect, useState } from "react";
import { ActionButton, ActionForm, FormMessage, SubmitButton, useServerForm } from "@/components/client";
import { useToast } from "@/components/toast";
import { Input } from "@/components/ui";
import { validateBands, type Band } from "@/lib/profile-score";
import { recalculateScores, updateScoring } from "@/server/scoring-actions";

/** Edits this role's score bands and minimum coverage. Saving creates a new scoring version. */
export function ScoringForm({ roleId, bands, minCoverage, canEdit }: { roleId: string; bands: Band[]; minCoverage: number; canEdit: boolean }) {
  const [state, action, pending] = useServerForm(updateScoring.bind(null, roleId));
  const [yellow, setYellow] = useState(String(bands[1].min));
  const [green, setGreen] = useState(String(bands[2].min));
  const toast = useToast();
  useEffect(() => {
    if (state?.ok && state.message) toast({ message: state.message });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  const preview: Band[] = [
    { ...bands[0], min: 0 },
    { ...bands[1], min: Number(yellow) },
    { ...bands[2], min: Number(green) },
  ];
  const err = validateBands(preview);
  const row = (key: "red" | "yellow" | "green", i: number) => (
    <div key={key} className="grid items-center gap-2 sm:grid-cols-[110px_150px_1fr]">
      <span className="flex items-center gap-1.5 text-[13px] font-medium">
        <span aria-hidden>{key === "red" ? "▼" : key === "yellow" ? "◆" : "▲"}</span>
        {key === "red" ? "Red" : key === "yellow" ? "Yellow" : "Green"}
      </span>
      <span className="flex items-center gap-1.5 text-[13px]">
        {i === 0 ? (
          <span className="text-muted">from 0</span>
        ) : (
          <>
            from
            <span className="w-20">
              <Input
                name={`min_${key}`}
                type="number"
                min={1}
                max={100}
                value={key === "yellow" ? yellow : green}
                onChange={(e) => (key === "yellow" ? setYellow(e.target.value) : setGreen(e.target.value))}
                disabled={!canEdit}
                aria-label={`${key} band starts at`}
              />
            </span>
          </>
        )}
        <span className="text-muted">to {i === 2 ? "100" : `below ${i === 0 ? yellow : green}`}</span>
      </span>
      <Input name={`label_${key}`} defaultValue={bands[i].label} maxLength={60} disabled={!canEdit} aria-label={`${key} band label`} />
    </div>
  );
  return (
    <ActionForm action={action} pending={pending} className="space-y-3">
      <div className="space-y-2">{(["red", "yellow", "green"] as const).map((k, i) => row(k, i))}</div>
      {err && <p className="text-[12.5px] text-danger">{err}</p>}
      <div className="flex flex-wrap items-center gap-2 text-[13px]">
        <span>Show “Insufficient evidence” below</span>
        <span className="w-20">
          <Input name="minCoverage" type="number" min={30} max={100} defaultValue={Math.round(minCoverage * 100)} disabled={!canEdit} aria-label="Minimum evidence coverage percent" />
        </span>
        <span>% weighted evidence coverage</span>
      </div>
      <Input name="note" placeholder="Why are you changing this? (recorded with the version)" maxLength={300} disabled={!canEdit} />
      <div className="flex flex-wrap items-center gap-2">
        <FormMessage state={state?.ok ? undefined : state} />
        {canEdit && (
          <SubmitButton size="sm" className="ml-auto" pendingLabel="Saving…" disabled={!!err}>
            Save as new version
          </SubmitButton>
        )}
      </div>
    </ActionForm>
  );
}

export function RecalculateButton({ roleId, version, outdated }: { roleId: string; version: number; outdated: number }) {
  return (
    <ActionButton
      action={() => recalculateScores(roleId)}
      variant={outdated ? "primary" : "secondary"}
      pendingLabel="Recalculating…"
      confirm={`Recalculate every candidate's latest score with scoring version ${version}? Earlier scores stay in each candidate's history; decisions don't change.`}
    >
      Recalculate scores (v{version}){outdated ? ` · ${outdated} on older versions` : ""}
    </ActionButton>
  );
}
