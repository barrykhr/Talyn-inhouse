"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, ICP_ENGINE_VERSION, aiStatus, generateIcpWithAi } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { ICP_CATEGORIES } from "@/lib/domain";
import { locateQuote } from "@/lib/evidence";
import { logError } from "@/lib/log";
import { str, type ActionState } from "./form";
import { ownRole } from "./scope";

const CATEGORY_KEYS = ICP_CATEGORIES.map((c) => c.key) as [string, ...string[]];

/** Generates a new draft ICP version from the approved criteria and JD. Nothing is approved automatically. */
export async function generateIcp(roleId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const role = await ownRole(auth, roleId);
  const criteria = await db.criterion.findMany({ where: { roleId, orgId: auth.orgId, status: "approved" }, orderBy: { position: "asc" } });
  if (!criteria.length) return { error: "Approve the role's criteria first — the ICP is built from them." };
  const jd = await db.jobDescription.findFirst({ where: { roleId, orgId: auth.orgId, isCurrent: true } });
  const pages = jd ? (JSON.parse(jd.pagesJson) as string[]) : [role.description];
  const jdText = pages.join("\n\n");

  type Draft = { category: string; value: string; origin: string; rationale: string | null; sourceQuote: string | null; sourcePage: number | null };
  let items: Draft[] = [];
  let clarifications: { question: string; why: string }[] = [];
  let generator: string;
  const ai = aiStatus();
  let notice: string | undefined;
  try {
    if (!ai.configured) throw new AiUnavailableError();
    const r = await generateIcpWithAi({
      title: role.title,
      location: role.location,
      employmentType: role.employmentType,
      criteria: criteria.map((c) => ({ name: c.name, importance: c.importance, description: c.description })),
      jdText,
    });
    generator = `ai:${ai.provider}:${ai.model}/${ICP_ENGINE_VERSION}`;
    items = r.items.map((i) => {
      // "Stated in the JD" must be backed by a quote that is actually in the JD.
      const loc = i.origin === "jd" && i.source_quote ? locateQuote({ resumePages: pages, profileText: "" }, i.source_quote, "resume") : null;
      const origin = i.origin === "jd" && !loc?.verified ? "ai_inferred" : i.origin;
      return {
        category: i.category,
        value: i.value.slice(0, 200),
        origin,
        rationale: i.rationale || null,
        sourceQuote: loc?.verified ? loc.quote : null,
        sourcePage: loc?.verified ? (loc.page ?? 1) : null,
      };
    });
    clarifications = r.clarifications;
  } catch (err) {
    if (!(err instanceof AiUnavailableError || err instanceof AiRequestError)) logError("icp.generate_failed", err, { roleId });
    // Labeled non-AI fallback: only what the recruiter already approved or entered.
    generator = "parser:icp-from-criteria-v1";
    notice = err instanceof AiUnavailableError ? "AI is off, so the profile was built from the approved criteria and role fields only." : `AI generation failed (${(err as Error).message}). Built from the approved criteria and role fields only.`;
    items = [
      { category: "target_title", value: role.title, origin: "criteria", rationale: "The role title.", sourceQuote: null, sourcePage: null },
      ...criteria.map((c) => ({
        category: c.importance === "essential" ? "skill_essential" : "skill_preferred",
        value: c.name,
        origin: "criteria",
        rationale: `${c.importance === "essential" ? "Essential" : "Preferred"} approved criterion.`,
        sourceQuote: c.sourceText,
        sourcePage: c.sourcePage,
      })),
      ...(role.location ? [{ category: "location", value: role.location, origin: "criteria", rationale: "Role location field.", sourceQuote: null, sourcePage: null }] : []),
    ];
  }
  const last = await db.icp.findFirst({ where: { roleId }, orderBy: { version: "desc" } });
  // Only one draft at a time: replace an unapproved draft rather than piling up versions.
  if (last?.status === "draft") await db.icp.delete({ where: { id: last.id } });
  const version = last?.status === "draft" ? last.version : (last?.version ?? 0) + 1;
  const icp = await db.icp.create({
    data: {
      orgId: auth.orgId,
      roleId,
      version,
      generator,
      criteriaVersion: role.criteriaVersion,
      clarificationsJson: JSON.stringify(clarifications),
      createdByName: auth.userName,
      items: {
        create: items.map((i, idx) => ({
          ...i,
          // Exclusions and AI inferences start unapproved; directly stated / approved-criteria items start ticked.
          status: i.category === "exclusion" || i.origin === "ai_inferred" ? "proposed" : "approved",
          position: idx,
        })),
      },
    },
  });
  await audit(auth, "icp.generated", { subjectType: "role", subjectId: icp.id, roleId, meta: { version, items: items.length, generator } });
  revalidatePath(`/roles/${roleId}`);
  return { ok: true, message: notice ?? `Draft profile v${version} ready for review.` };
}

/** Saves the recruiter's edits to a draft ICP and, if asked, approves it (superseding the previous approved version). */
export async function saveIcp(icpId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const icp = await db.icp.findFirst({ where: { id: icpId, orgId: auth.orgId }, include: { items: true } });
  if (!icp) return { error: "Profile not found." };
  if (icp.status !== "draft") return { error: "Only a draft can be edited. Start a revision first." };
  const approve = str(fd, "intent") === "approve";

  const ops = icp.items.map((it) => {
    const keep = fd.get(`use_${it.id}`) === "on";
    const value = str(fd, `value_${it.id}`, 200) || it.value;
    return db.icpItem.update({ where: { id: it.id }, data: { status: keep ? "approved" : "rejected", value, edited: it.edited || value !== it.value } });
  });
  // New recruiter-added items: new_<category>_<n>
  const additions: { category: string; value: string }[] = [];
  for (const [k, v] of fd.entries()) {
    const m = /^new_([a-z_]+)_\d+$/.exec(k);
    if (m && typeof v === "string" && v.trim() && z.enum(CATEGORY_KEYS).safeParse(m[1]).success) additions.push({ category: m[1], value: v.trim().slice(0, 200) });
  }
  const clar = (JSON.parse(icp.clarificationsJson) as { question: string; why: string; answer?: string }[]).map((c, i) => ({ ...c, answer: str(fd, `answer_${i}`, 1000) || c.answer || "" }));

  if (approve) {
    const titles = icp.items.filter((i) => i.category === "target_title" && fd.get(`use_${i.id}`) === "on").length + additions.filter((a) => a.category === "target_title").length;
    if (!titles) return { error: "Keep at least one target title before approving." };
  }
  await db.$transaction([
    ...ops,
    ...additions.map((a, i) =>
      db.icpItem.create({ data: { icpId, category: a.category, value: a.value, origin: "recruiter", status: "approved", position: 1000 + i } }),
    ),
    db.icp.update({
      where: { id: icpId },
      data: {
        clarificationsJson: JSON.stringify(clar),
        ...(approve ? { status: "approved", approvedByName: auth.userName, approvedAt: new Date() } : {}),
      },
    }),
    ...(approve ? [db.icp.updateMany({ where: { roleId: icp.roleId, status: "approved", NOT: { id: icpId } }, data: { status: "superseded" } })] : []),
  ]);
  if (approve) await audit(auth, "icp.approved", { subjectType: "role", subjectId: icpId, roleId: icp.roleId, meta: { version: icp.version } });
  revalidatePath(`/roles/${icp.roleId}`);
  return { ok: true, message: approve ? `Profile v${icp.version} approved. It now drives search.` : "Draft saved." };
}

/** Starts a new draft version from the approved ICP. */
export async function reviseIcp(icpId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const icp = await db.icp.findFirst({ where: { id: icpId, orgId: auth.orgId }, include: { items: true } });
  if (!icp) return { error: "Profile not found." };
  const existingDraft = await db.icp.findFirst({ where: { roleId: icp.roleId, status: "draft" } });
  if (existingDraft) return { ok: true };
  const last = await db.icp.findFirst({ where: { roleId: icp.roleId }, orderBy: { version: "desc" } });
  await db.icp.create({
    data: {
      orgId: auth.orgId,
      roleId: icp.roleId,
      version: (last?.version ?? 0) + 1,
      generator: `revision-of-v${icp.version}`,
      criteriaVersion: icp.criteriaVersion,
      clarificationsJson: icp.clarificationsJson,
      createdByName: auth.userName,
      items: {
        create: icp.items.map(({ category, value, origin, rationale, sourceQuote, sourcePage, status, edited, position }) => ({
          category,
          value,
          origin,
          rationale,
          sourceQuote,
          sourcePage,
          status,
          edited,
          position,
        })),
      },
    },
  });
  revalidatePath(`/roles/${icp.roleId}`);
  return { ok: true };
}
