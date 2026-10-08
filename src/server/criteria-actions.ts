"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, proposeCriteriaWithAi } from "@/lib/ai";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { IMPORTANCE } from "@/lib/domain";
import { extractCriteriaFromJd } from "@/lib/heuristics";
import { logError } from "@/lib/log";
import { str, type ActionState } from "./form";
import { bumpCriteriaVersion, storeProposedCriteria } from "./facts";
import { ownCriterion, ownRole } from "./scope";

const CriterionSchema = z.object({
  name: z.string().min(1, "Name is required").max(200),
  description: z.string().max(2000),
  importance: z.enum(IMPORTANCE),
  priority: z.number().int().min(1).max(10).nullable(),
});

function parseCriterion(fd: FormData) {
  const p = str(fd, "priority");
  return CriterionSchema.safeParse({
    name: str(fd, "name", 200),
    description: str(fd, "description", 2000),
    importance: str(fd, "importance") || "essential",
    priority: p ? Number(p) : null,
  });
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
  await bumpCriteriaVersion(roleId);
  revalidatePath(`/roles/${roleId}`);
  return { ok: true };
}

export async function updateCriterion(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const c = await ownCriterion(auth, id);
  const parsed = parseCriterion(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const edited =
    c.origin !== "manual" &&
    (parsed.data.name !== (c.originalName ?? c.name) || parsed.data.description !== (c.originalDescription ?? c.description));
  await db.criterion.update({ where: { id }, data: { ...parsed.data, edited } });
  if (c.status === "approved") await bumpCriteriaVersion(c.roleId);
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
  if ((c.status === "approved") !== (s === "approved")) await bumpCriteriaVersion(c.roleId);
  revalidatePath(`/roles/${c.roleId}`);
}

export async function approveAllProposed(roleId: string) {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  const { count } = await db.criterion.updateMany({
    where: { roleId, orgId: auth.orgId, status: "proposed" },
    data: { status: "approved", approvedById: auth.userId, approvedAt: new Date() },
  });
  if (count) await bumpCriteriaVersion(roleId);
  revalidatePath(`/roles/${roleId}`);
}

export async function deleteCriterion(id: string) {
  const auth = await requireAuth();
  const c = await ownCriterion(auth, id);
  await db.criterion.delete({ where: { id } });
  if (c.status === "approved") await bumpCriteriaVersion(c.roleId);
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

  type Draft = { name: string; description: string; importance: string; sourceText: string | null; rationale: string | null };
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
      sourceText: d.sourceText,
      sourcePage: null,
      sourceSection: null,
      rationale: d.rationale,
    })),
    mode === "ai" ? "ai" : "extracted",
  );
  revalidatePath(`/roles/${roleId}`);
  return { ok: true, message: `${drafts.length} criteria proposed. Review each one before it is used.` };
}
