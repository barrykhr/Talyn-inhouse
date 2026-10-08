"use client";

import { useRouter } from "next/navigation";
import { usePendingTask } from "@/components/client";
import { useToast } from "@/components/toast";
import { setPriority } from "@/server/ranking-actions";

const LABEL: Record<string, string> = { "1": "High", "0": "Normal", "-1": "Low" };

/** Recruiter override of ordering. Ranking never moves a stage. */
export function PrioritySelect({ applicationId, priority }: { applicationId: string; priority: number }) {
  const [pending, start] = usePendingTask();
  const router = useRouter();
  const toast = useToast();
  return (
    <select
      aria-label="Recruiter priority"
      defaultValue={String(priority)}
      disabled={pending}
      onChange={(e) => {
        const v = Number(e.target.value);
        start(async () => {
          await setPriority(applicationId, v);
          toast({ message: `Priority set to ${LABEL[String(v)]} — the stage is unchanged` });
          router.refresh();
        });
      }}
      className="h-7 rounded-md border border-line bg-surface px-1 text-[12px] text-ink-2 focus:border-ink focus:outline-none"
    >
      <option value="1">High</option>
      <option value="0">Normal</option>
      <option value="-1">Low</option>
    </select>
  );
}
