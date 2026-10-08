"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { FIELD_LABEL, SYNCED_FIELDS, getAtsConnector } from "@/lib/ats/connector";
import { processOutbox, pullFromAts } from "@/lib/ats/sync";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { STAGES } from "@/lib/domain";
import { logError } from "@/lib/log";
import { str, type ActionState } from "./form";
import { ownRole } from "./scope";

async function admin(): Promise<AuthContext | null> {
  const auth = await requireAuth();
  return auth.membershipRole === "admin" ? auth : null;
}
const refresh = () => {
  revalidatePath("/settings/integrations");
  revalidatePath("/queue");
};

/** Links this workspace to the configured ATS. Only one workspace can be linked to an ATS. */
export async function linkAts(): Promise<ActionState> {
  const auth = await admin();
  if (!auth) return { error: "Only workspace admins can do this." };
  if (!getAtsConnector()) return { error: "No ATS is configured." };
  const other = await db.organization.findFirst({ where: { atsLinkedAt: { not: null }, id: { not: auth.orgId } }, select: { id: true } });
  if (other) return { error: "Another workspace is already linked to this ATS. Unlink it there first." };
  await db.organization.update({ where: { id: auth.orgId }, data: { atsLinkedAt: new Date(), atsLinkedBy: auth.userName } });
  await audit(auth, "ats.linked", { subjectType: "org", subjectId: auth.orgId });
  refresh();
  return { ok: true, message: "Linked. Run a sync to bring in candidates; link roles to ATS jobs from each role's ATS page." };
}

export async function unlinkAts(): Promise<ActionState> {
  const auth = await admin();
  if (!auth) return { error: "Only workspace admins can do this." };
  // Unlinking stops syncing. Records already in Talyn are kept; pending pushes are cancelled.
  await db.$transaction([
    db.organization.update({ where: { id: auth.orgId }, data: { atsLinkedAt: null, atsLinkedBy: null } }),
    db.atsOutbox.updateMany({ where: { orgId: auth.orgId, status: { in: ["pending", "failed"] } }, data: { status: "skipped", lastError: "Workspace unlinked from the ATS" } }),
  ]);
  await audit(auth, "ats.unlinked", { subjectType: "org", subjectId: auth.orgId });
  refresh();
  return { ok: true, message: "Unlinked. Existing records stay in Talyn." };
}

export async function syncAtsNow(): Promise<ActionState> {
  const auth = await admin();
  if (!auth) return { error: "Only workspace admins can do this." };
  const org = await db.organization.findUnique({ where: { id: auth.orgId }, select: { atsLinkedAt: true } });
  if (!getAtsConnector() || !org?.atsLinkedAt) return { error: "Connect and link an ATS first." };
  try {
    const pull = await pullFromAts(auth.orgId, auth.userName);
    const push = await processOutbox(auth.orgId);
    refresh();
    if (!pull) return { error: "No ATS is configured." };
    return {
      ok: true,
      message: `${pull.created} created · ${pull.updated} updated · ${pull.unchanged} unchanged${pull.conflicts ? ` · ${pull.conflicts} conflict(s) to review` : ""}${pull.errors ? ` · ${pull.errors} problem(s) — see sync history` : ""}${push ? ` · ${push.sent} stage change(s) pushed` : ""}.`,
    };
  } catch (err) {
    logError("ats.sync_now_failed", err);
    refresh();
    return { error: "The sync failed. See sync history for details." };
  }
}

export async function resolveConflict(id: string, choice: "kept_talyn" | "used_ats"): Promise<ActionState> {
  const auth = await requireAuth();
  const c = await db.atsConflict.findFirst({ where: { id, orgId: auth.orgId, status: "open" } });
  if (!c) return { error: "Conflict not found or already resolved." };
  const pick = z.enum(["kept_talyn", "used_ats"]).parse(choice);
  if (!SYNCED_FIELDS.includes(c.field)) return { error: "Unknown field." };
  if (pick === "used_ats") {
    const cand = await db.candidate.findFirst({ where: { id: c.candidateId, orgId: auth.orgId } });
    if (!cand) return { error: "Candidate not found." };
    if (c.field === "email") {
      const dupe = await db.candidate.findFirst({ where: { orgId: auth.orgId, email: c.atsValue, NOT: { id: cand.id } }, select: { id: true } });
      if (dupe) return { error: "Another candidate already uses that email. Merge or edit them first." };
    }
    const origins = JSON.parse(cand.fieldOriginsJson || "{}") as Record<string, string>;
    origins[c.field] = "ats";
    await db.candidate.update({ where: { id: cand.id }, data: { [c.field]: c.atsValue, fieldOriginsJson: JSON.stringify(origins) } });
  }
  await db.atsConflict.update({ where: { id }, data: { status: pick, resolvedByName: auth.userName, resolvedAt: new Date() } });
  await audit(auth, "ats.conflict_resolved", { subjectType: "candidate", subjectId: c.candidateId, candidateId: c.candidateId, meta: { field: c.field, choice: pick } });
  revalidatePath(`/candidates/${c.candidateId}`);
  refresh();
  return { ok: true, message: `${FIELD_LABEL[c.field]}: ${pick === "used_ats" ? "using the ATS value" : "keeping Talyn's value"}.` };
}

/** Links a role to an ATS job and saves the per-role stage mapping. */
export async function saveRoleAtsSettings(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await admin();
  if (!auth) return { error: "Only workspace admins can do this." };
  const role = await ownRole(auth, roleId);
  const jobId = str(fd, "jobId", 200) || null;
  if (jobId) {
    const taken = await db.role.findFirst({ where: { orgId: auth.orgId, atsExternalId: jobId, NOT: { id: role.id } }, select: { title: true } });
    if (taken) return { error: `That ATS job is already linked to “${taken.title}”.` };
  }
  await db.role.update({ where: { id: role.id }, data: { atsExternalId: jobId } });
  for (const st of STAGES) {
    const v = str(fd, `stage_${st}`, 120);
    const atsStage = v && v !== "__none" ? v : null;
    await db.atsStageMap.upsert({
      where: { roleId_talynStage: { roleId: role.id, talynStage: st } },
      create: { orgId: auth.orgId, roleId: role.id, talynStage: st, atsStage },
      update: { atsStage },
    });
  }
  await audit(auth, "ats.stage_map_saved", { subjectType: "role", subjectId: role.id, roleId: role.id, meta: { linked: Boolean(jobId) } });
  revalidatePath(`/roles/${role.id}/ats`);
  return { ok: true, message: "ATS settings saved." };
}

export async function retryOutbox(id: string): Promise<ActionState> {
  const auth = await requireAuth();
  const it = await db.atsOutbox.findFirst({ where: { id, orgId: auth.orgId, status: "failed" } });
  if (!it) return { error: "Nothing to retry." };
  await db.atsOutbox.update({ where: { id }, data: { status: "pending", nextAttemptAt: new Date(), attempts: 0 } });
  await processOutbox(auth.orgId);
  refresh();
  const after = await db.atsOutbox.findUnique({ where: { id }, select: { status: true } });
  return after?.status === "sent" ? { ok: true, message: "Pushed to the ATS." } : { error: "The ATS still didn't accept it. It will retry automatically." };
}

export async function dismissOutbox(id: string): Promise<ActionState> {
  const auth = await requireAuth();
  const it = await db.atsOutbox.findFirst({ where: { id, orgId: auth.orgId, status: "failed" } });
  if (!it) return { error: "Nothing to dismiss." };
  await db.atsOutbox.update({ where: { id }, data: { status: "skipped", lastError: `Dismissed by ${auth.userName}; update the ATS manually` } });
  refresh();
  return { ok: true };
}
