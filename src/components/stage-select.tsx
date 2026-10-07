"use client";

import clsx from "clsx";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { STAGES, STAGE_LABEL } from "@/lib/domain";
import { moveStage } from "@/server/candidate-actions";

export function StageSelect({ applicationId, stage, className }: { applicationId: string; stage: string; className?: string }) {
  const [pending, start] = useTransition();
  const router = useRouter();
  return (
    <select
      aria-label="Pipeline stage"
      value={stage}
      disabled={pending}
      onChange={(e) => {
        const to = e.target.value;
        if (to === "rejected" && !window.confirm("Move this candidate to Rejected? This is recorded in their history.")) return;
        start(async () => {
          await moveStage(applicationId, to);
          router.refresh();
        });
      }}
      className={clsx(
        "h-7 rounded-md border border-line-strong bg-surface px-1.5 text-[12.5px] font-medium text-ink-2 focus:border-ink focus:outline-none",
        pending && "opacity-60",
        className,
      )}
    >
      {STAGES.map((s) => (
        <option key={s} value={s}>{STAGE_LABEL[s]}</option>
      ))}
    </select>
  );
}
