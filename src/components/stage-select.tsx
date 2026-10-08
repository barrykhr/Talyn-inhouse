"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { STAGES, STAGE_LABEL, type Stage } from "@/lib/domain";
import { moveStage } from "@/server/candidate-actions";
import { usePendingTask } from "./client";
import { useToast } from "./toast";

/** Recruiter-controlled stage change, confirmed with a quiet toast and a one-click Undo. */
export function StageSelect({ applicationId, stage, className }: { applicationId: string; stage: string; className?: string }) {
  const [pending, start] = usePendingTask();
  const [value, setValue] = useState(stage);
  const router = useRouter();
  const toast = useToast();
  const move = (to: string, from: string, announce = true) =>
    start(async () => {
      setValue(to);
      await moveStage(applicationId, to);
      router.refresh();
      if (announce)
        toast({
          message: `Moved to ${STAGE_LABEL[to as Stage]}`,
          action: { label: "Undo", run: () => move(from, to, false) },
        });
    });
  return (
    <select
      aria-label="Pipeline stage"
      value={value}
      disabled={pending}
      onChange={(e) => {
        const to = e.target.value;
        if (to === "rejected" && !window.confirm("Move this candidate to Rejected? This is recorded in their history.")) return;
        move(to, value);
      }}
      className={clsx(
        "h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12.5px] font-medium text-ink-2 transition-opacity focus:border-ink focus:outline-none",
        pending && "opacity-60",
        className,
      )}
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>
          {STAGE_LABEL[s]}
        </option>
      ))}
    </select>
  );
}
