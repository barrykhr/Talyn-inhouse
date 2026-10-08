"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionState } from "./form";
import { ownApplication } from "./scope";

/** Recruiter priority override. Affects ordering only — never the stage or decision. */
export async function setPriority(applicationId: string, priority: number, note?: string): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const p = priority > 0 ? 1 : priority < 0 ? -1 : 0;
  await db.application.update({ where: { id: applicationId }, data: { priority: p, priorityNote: note?.slice(0, 500) || null, priorityByName: auth.userName, priorityAt: new Date() } });
  await audit(auth, "priority.changed", { subjectType: "application", subjectId: applicationId, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { priority: p } });
  revalidatePath(`/roles/${app.roleId}`);
  return { ok: true };
}
