"use client";

import { useRouter } from "next/navigation";

import { Select } from "@/components/ui";
import { addToRole } from "@/server/candidate-actions";
import { usePendingTask } from "@/components/client";

export function AddToRole({ candidateId, roles }: { candidateId: string; roles: { id: string; title: string }[] }) {
  const [pending, start] = usePendingTask();
  const router = useRouter();
  if (roles.length === 0) return null;
  return (
    <Select
      aria-label="Add to role"
      value=""
      disabled={pending}
      className="h-8 w-auto text-[13px]"
      onChange={(e) => {
        const roleId = e.target.value;
        if (!roleId) return;
        start(async () => {
          await addToRole(candidateId, roleId);
          router.push(`/candidates/${candidateId}?role=${roleId}`);
          router.refresh();
        });
      }}
    >
      <option value="">{pending ? "Adding…" : "+ Add to role"}</option>
      {roles.map((r) => (
        <option key={r.id} value={r.id}>{r.title}</option>
      ))}
    </Select>
  );
}
