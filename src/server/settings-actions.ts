"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { eligibleForRetention } from "@/lib/retention";
import { str, type ActionState } from "./form";

export async function setRetention(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can change retention." };
  const raw = str(fd, "retentionDays");
  const days = raw === "" ? null : Number(raw);
  if (days !== null && (!Number.isInteger(days) || days < 30 || days > 3650)) return { error: "Choose between 30 and 3650 days, or keep until deleted." };
  await db.organization.update({ where: { id: auth.orgId }, data: { retentionDays: days } });
  await audit(auth, "org.retention_changed", { subjectType: "org", subjectId: auth.orgId, meta: { days } });
  revalidatePath("/settings");
  return { ok: true, message: days ? `Inactive candidates become eligible for deletion after ${days} days.` : "Candidates are kept until deleted." };
}

/** Deletes candidates past the retention period now (also runs daily via /api/cron/retention when configured). */
export async function applyRetentionNow(): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can apply retention." };
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId } });
  if (!org.retentionDays) return { error: "Set a retention period first." };
  const ids = await eligibleForRetention(auth.orgId, org.retentionDays);
  if (ids.length) await db.candidate.deleteMany({ where: { orgId: auth.orgId, id: { in: ids } } });
  await audit(auth, "retention.applied", { subjectType: "org", subjectId: auth.orgId, meta: { deleted: ids.length, days: org.retentionDays } });
  revalidatePath("/settings");
  return { ok: true, message: `${ids.length} inactive candidate${ids.length === 1 ? "" : "s"} deleted.` };
}
