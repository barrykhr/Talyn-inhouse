"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, proposeCriteriaWithAi } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { CRITERION_IMPORTANCE, CRITERION_KINDS } from "@/lib/domain";
import { audit } from "@/lib/audit";
import { extractCriteriaFromJd } from "@/lib/heuristics";
import { logError } from "@/lib/log";
import { str, type ActionState } from "./form";
import { bumpCriteriaVersion, storeProposedCriteria } from "./facts";
import { ownCriterion, ownRole } from "./scope";

const CriterionSchema = z
  .object({
    name: z.string().min(1, "Name is required").max(200),
    description: z.string().max(2000),
    kind: z.enum(CRITERION_KINDS),
    importance: z.enum(CRITERION_IMPORTANCE),
    priority: z.number().int().min(1).max(10).nullable(),
    aliases: z.string().max(500),
    mappedCriterionId: z.string().nullable(),
  })
  .refine((c) => c.kind === "criterion" || c.importance !== "informational", { message: "Skills are required or preferred." });

function parseCriterion(fd: FormData) {
  const p = str(fd, "priority");
  const kind = str(fd, "kind") || "criterion";
  return CriterionSchema.safeParse({
    name: str(fd, "name", 200),
    description: str(fd, "description", 2000),
    kind,
    importance: str(fd, "importance") || "essential",
    priority: p ? Number(p) : null,
    aliases: kind === "skill" ? str(fd, "aliases", 500) : "",
    mappedCriterionId: kind === "skill" ? str(fd, "mappedCriterionId") || null : null,
  });
}

/** A skill may only map to an evaluation criterion of the same role. */
async function checkMapping(orgId: string, roleId: string, mappedCriterionId: string | null, selfId?: string) {
  if (!mappedCriterionId) return null;
  if (mappedCriterionId === selfId) return "A skill can't map to itself.";
  const target = await db.criterion.findFirst({ where: { id: mappedCriterionId, orgId, roleId, kind: "criterion" }, select: { id: true } });
  return target ? null : "Choose an evaluation criterion from this role.";
}

async function nextPosition(roleId: string) {
  const last = await db.criterion.findFirst({ where: { roleId }, orderBy: { position: "desc" } });
  return (last?.position ?? 0) + 1;
}

/** Criteria written by a recruiter are active immediately — the recruiter is the approver. */
export async function addCriterion(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  const parsed = parseCriterion(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const mapErr = await checkMapping(auth.orgId, roleId, parsed.data.mappedCriterionId);
  if (mapErr) return { error: mapErr };
  await db.criterion.create({
    data: {
      ...parsed.data,
      orgId: auth.orgId,
      roleId,
      origin: "manual",
      status: "approved",
      approvedById: auth.userId,
      approvedAt: new Date(),
      position: await nextPosition(roleId),
    },
  });
  await bumpCriteriaVersion(roleId, auth, "added");
  revalidatePath(`/roles/${roleId}`);
  return { ok: true };
}

export async function updateCriterion(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const c = await ownCriterion(auth, id);
  const parsed = parseCriterion(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const mapErr = await checkMapping(auth.orgId, c.roleId, parsed.data.mappedCriterionId, id);
  if (mapErr) return { error: mapErr };
  if (c.kind === "criterion" && parsed.data.kind === "skill") await db.criterion.updateMany({ where: { orgId: auth.orgId, roleId: c.roleId, mappedCriterionId: id }, data: { mappedCriterionId: null } });
  const edited =
    c.origin !== "manual" &&
    (parsed.data.name !== (c.originalName ?? c.name) || parsed.data.description !== (c.originalDescription ?? c.description));
  await db.criterion.update({ where: { id }, data: { ...parsed.data, edited } });
  if (c.status === "approved") await bumpCriteriaVersion(c.roleId, auth, "edited");
  revalidatePath(`/roles/${c.roleId}`);
  return { ok: true };
}

export async function setCriterionStatus(id: string, status: "approved" | "rejected" | "proposed") {
  const auth = await requireAuth();
  const c = await ownCriterion(auth, id);
  const s = z.enum(["approved", "rejected", "proposed"]).parse(status);
  await db.criterion.update({
    where: { id },
    data: {
      status: s,
      approvedById: s === "approved" ? auth.userId : null,
      approvedAt: s === "approved" ? new Date() : null,
    },
  });
  if ((c.status === "approved") !== (s === "approved")) await bumpCriteriaVersion(c.roleId, auth, s === "approved" ? "approved" : "unapproved");
  revalidatePath(`/roles/${c.roleId}`);
}

export async function approveAllProposed(roleId: string) {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  const { count } = await db.criterion.updateMany({
    where: { roleId, orgId: auth.orgId, status: "proposed" },
    data: { status: "approved", approvedById: auth.userId, approvedAt: new Date() },
  });
  if (count) await bumpCriteriaVersion(roleId, auth, "approved_all");
  revalidatePath(`/roles/${roleId}`);
}

export async function deleteCriterion(id: string) {
  const auth = await requireAuth();
  const c = await ownCriterion(auth, id);
  await db.criterion.delete({ where: { id } });
  await db.criterion.updateMany({ where: { orgId: auth.orgId, roleId: c.roleId, mappedCriterionId: id }, data: { mappedCriterionId: null } });
  if (c.status === "approved") await bumpCriteriaVersion(c.roleId, auth, "deleted");
  revalidatePath(`/roles/${c.roleId}`);
}

/**
 * Drafts criteria from the job description. `mode: "ai"` asks the model; `mode: "extract"`
 * pulls bullet points from requirement sections without AI. Either way, results land as
 * "proposed" and are inactive until a recruiter approves them.
 */
export async function proposeCriteria(roleId: string, mode: "ai" | "extract"): Promise<ActionState> {
  const auth = await requireAuth();
  const role = await ownRole(auth, roleId);
  if (role.description.trim().length < 40) return { error: "Add a job description (at least a few lines) first." };

  type Draft = { name: string; description: string; importance: string; kind: "skill" | "criterion"; sourceText: string | null; rationale: string | null };
  let drafts: Draft[] = [];
  if (mode === "ai") {
    try {
      const proposed = await proposeCriteriaWithAi({ title: role.title, description: role.description });
      drafts = proposed.map((p) => {
        // Keep the citation only if it really appears in the job description.
        const inJd = p.source_quote && role.description.replace(/\s+/g, " ").toLowerCase().includes(p.source_quote.replace(/\s+/g, " ").toLowerCase());
        return {
          name: p.name.slice(0, 200),
          description: p.description.slice(0, 2000),
          importance: p.importance,
          kind: p.kind,
          sourceText: inJd ? p.source_quote : null,
          rationale: p.rationale || null,
        };
      });
    } catch (err) {
      if (err instanceof AiUnavailableError || err instanceof AiRequestError) return { error: err.message };
      logError("criteria.propose_failed", err, { roleId });
      return { error: "Could not propose criteria. Please try again." };
    }
  } else {
    drafts = extractCriteriaFromJd(role.description).map((e) => ({
      name: e.name,
      description: "",
      importance: e.importance,
      kind: e.kind,
      sourceText: e.sourceText,
      rationale: "Bullet point from a requirements section of the job description.",
    }));
    if (drafts.length === 0)
      return { error: "No bullet-point requirements found. Add criteria manually, or format requirements as a bulleted list." };
  }

  await storeProposedCriteria(
    auth.orgId,
    roleId,
    drafts.map((d) => ({
      name: d.name,
      description: d.description,
      importance: d.importance === "preferred" ? "preferred" : "essential",
      kind: d.kind,
      sourceText: d.sourceText,
      sourcePage: null,
      sourceSection: null,
      rationale: d.rationale,
    })),
    mode === "ai" ? "ai" : "extracted",
  );
  revalidatePath(`/roles/${roleId}`);
  const skills = drafts.filter((d) => d.kind === "skill").length;
  return { ok: true, message: `${skills} skill${skills === 1 ? "" : "s"} and ${drafts.length - skills} criteri${drafts.length - skills === 1 ? "on" : "a"} suggested from the JD. Review each one before it is used.` };
}

/**
 * The role's skill-matching rubric: minimum required skills, whether partial evidence counts,
 * and the evaluation-criteria weights. Applied live to every candidate's latest assessment —
 * no reassessment needed, and never used to reject, hide or advance anyone.
 */
export async function updateRubric(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const role = await ownRole(auth, roleId);
  const t = str(fd, "skillThreshold");
  const requiredSkills = await db.criterion.count({ where: { orgId: auth.orgId, roleId, kind: "skill", status: "approved", importance: { not: "preferred" } } });
  const parsed = z
    .object({
      skillThreshold: z.number().int().min(1, "The minimum must be at least 1.").max(50).nullable(),
      skillPartialCredit: z.boolean(),
      weightRequired: z.number().int().min(1, "Weights are whole numbers from 1 to 10.").max(10, "Weights are whole numbers from 1 to 10."),
      weightPreferred: z.number().int().min(1, "Weights are whole numbers from 1 to 10.").max(10, "Weights are whole numbers from 1 to 10."),
    })
    .safeParse({
      skillThreshold: t ? Number(t) : null,
      skillPartialCredit: fd.get("skillPartialCredit") === "on",
      weightRequired: Number(str(fd, "weightRequired") || role.weightRequired),
      weightPreferred: Number(str(fd, "weightPreferred") || role.weightPreferred),
    });
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (parsed.data.skillThreshold != null && parsed.data.skillThreshold > requiredSkills)
    return { error: `The minimum can't be more than the ${requiredSkills} approved required skill${requiredSkills === 1 ? "" : "s"}.` };
  await db.role.update({ where: { id: roleId }, data: { ...parsed.data, rubricUpdatedBy: auth.userName, rubricUpdatedAt: new Date() } });
  await audit(auth, "rubric.changed", {
    subjectType: "role",
    subjectId: roleId,
    roleId,
    meta: {
      skillThreshold: parsed.data.skillThreshold,
      partialCredit: parsed.data.skillPartialCredit,
      weights: `${parsed.data.weightRequired}/${parsed.data.weightPreferred}`,
      previous: `threshold ${role.skillThreshold ?? "none"} · partial ${role.skillPartialCredit ? "on" : "off"} · weights ${role.weightRequired}/${role.weightPreferred}`,
    },
  });
  revalidatePath(`/roles/${roleId}`);
  return { ok: true, message: "Rubric saved. Counts and threshold status update for every candidate right away." };
}

/** Moves an item up or down within its group (same kind and importance). Order only — never changes assessments. */
export async function moveCriterion(id: string, dir: "up" | "down") {
  const auth = await requireAuth();
  const c = await ownCriterion(auth, id);
  const siblings = await db.criterion.findMany({
    where: { orgId: auth.orgId, roleId: c.roleId, kind: c.kind, importance: c.importance, status: c.status },
    orderBy: [{ priority: "asc" }, { position: "asc" }],
    select: { id: true, position: true, priority: true },
  });
  const i = siblings.findIndex((x) => x.id === id);
  const j = dir === "up" ? i - 1 : i + 1;
  if (i < 0 || j < 0 || j >= siblings.length) return;
  // Re-number the group in its current display order with the two swapped. Manual order replaces
  // the optional priority numbers in this group, so what you see is the order that's stored.
  const order = [...siblings];
  [order[i], order[j]] = [order[j], order[i]];
  const base = Math.min(...siblings.map((x) => x.position));
  // Raw update on purpose: order is not content, so it must not bump updatedAt (which would mark
  // every assessment out of date).
  await db.$transaction(order.map((x, k) => db.$executeRaw`UPDATE "Criterion" SET "position" = ${base + k}, "priority" = NULL WHERE "id" = ${x.id} AND "orgId" = ${auth.orgId}`));
  revalidatePath(`/roles/${c.roleId}`);
}
