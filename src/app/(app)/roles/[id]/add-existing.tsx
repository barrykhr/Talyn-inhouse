"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Spinner, usePendingTask } from "@/components/client";
import { buttonClass, Select } from "@/components/ui";
import { addToRole } from "@/server/candidate-actions";

export function AddExisting({ roleId, candidates }: { roleId: string; candidates: { id: string; fullName: string; currentTitle: string | null }[] }) {
  const [value, setValue] = useState("");
  const [pending, start] = usePendingTask();
  const router = useRouter();
  if (candidates.length === 0) return null;
  return (
    <div className="flex items-center gap-2">
      <Select value={value} onChange={(e) => setValue(e.target.value)} className="h-9 w-56" aria-label="Add an existing candidate">
        <option value="">Add existing candidate…</option>
        {candidates.map((c) => (
          <option key={c.id} value={c.id}>
            {c.fullName}{c.currentTitle ? ` — ${c.currentTitle}` : ""}
          </option>
        ))}
      </Select>
      <button
        type="button"
        disabled={!value || pending}
        className={buttonClass("secondary")}
        onClick={() =>
          start(async () => {
            await addToRole(value, roleId);
            setValue("");
            router.refresh();
          })
        }
      >
        {pending && <Spinner />}Add
      </button>
    </div>
  );
}
