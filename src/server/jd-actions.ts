"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DocumentParseError, parseDocument } from "@/lib/documents";
import { EMPLOYMENT_TYPES } from "@/lib/domain";
import { draftJdCriteria, extractJdDetails } from "@/lib/extraction";
import { logError } from "@/lib/log";
import { storeFacts, storeProposedCriteria } from "./facts";
import { goTo, str, type ActionState } from "./form";
import { ownRole } from "./scope";

async function readUpload(fd: FormData) {
  const file = fd.get("jd");
  if (!(file instanceof File) || file.size === 0) throw new DocumentParseError("empty", "Choose a PDF or DOCX job description to upload.");
  const data = Buffer.from(await file.arrayBuffer());
  const parsed = await parseDocument(file.name, data, { allowText: false });
  return { file, data, parsed };
}

export type StepResult = { ok?: boolean; error?: string; notice?: string | null; roleId?: string; count?: number };

/**
 * Stage 1 — "Uploading": reads the file and stores it. With no roleId a new draft role is
 * created (its description is the JD text, the source document). Nothing is extracted yet.
 */
export async function uploadJd(roleId: string | null, fd: FormData): Promise<StepResult> {
  const auth = await requireAuth();
  if (roleId) await ownRole(auth, roleId);
  let upload;
  try {
    upload = await readUpload(fd);
  } catch (err) {
    if (err instanceof DocumentParseError) return { error: err.message };
    logError("jd.parse_failed", err);
    return { error: "The file couldn't be read. Try again, or enter the role details manually." };
  }
  if (!roleId) {
    const role = await db.role.create({
      data: {
        orgId: auth.orgId,
        title: `Untitled role (from ${upload.file.name.replace(/\.[^.]+$/, "").slice(0, 80)})`,
        description: upload.parsed.pages.join("\n\n").slice(0, 30000),
        status: "draft",
        createdById: auth.userId,
      },
    });
    roleId = role.id;
  }
  await db.jobDescription.updateMany({ where: { roleId, orgId: auth.orgId }, data: { isCurrent: false } });
  await db.jobDescription.create({
    data: {
      orgId: auth.orgId,
      roleId,
      fileName: upload.file.name.slice(0, 200),
      mimeType: upload.parsed.mimeType,
      sizeBytes: upload.data.length,
      pagesJson: JSON.stringify(upload.parsed.pages),
      parserVersion: upload.parsed.parserVersion,
      file: { create: { orgId: auth.orgId, data: new Uint8Array(upload.data) } },
    },
  });
  await db.role.update({ where: { id: roleId }, data: { extractionStatus: "needs_review" } });
  await audit(auth, "jd.uploaded", { subjectType: "role", subjectId: roleId, roleId, meta: { parser: upload.parsed.parserVersion } });
  return { ok: true, roleId };
}

async function currentJd(orgId: string, roleId: string) {
  const jd = await db.jobDescription.findFirst({ where: { roleId, orgId, isCurrent: true } });
  return jd ? { jd, pages: JSON.parse(jd.pagesJson) as string[] } : null;
}

/** Stage 2 — "Extracting information": role details from the current JD, as pending facts. */
export async function extractJdStep(roleId: string): Promise<StepResult> {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  const cur = await currentJd(auth.orgId, roleId);
  if (!cur) return { error: "No uploaded job description found for this role." };
  try {
    const out = await extractJdDetails(cur.pages);
    await storeFacts(auth.orgId, { type: "role", roleId }, cur.jd.id, out.facts);
    await audit(auth, "jd.extracted", { subjectType: "role", subjectId: cur.jd.id, roleId, meta: { facts: out.facts.length, method: out.method } });
    return { ok: true, notice: out.notice, count: out.facts.length };
  } catch (err) {
    logError("jd.extract_failed", err, { roleId });
    return { error: "Details couldn't be extracted. The JD is saved — you can enter the details yourself." };
  }
}

/** Stage 3 — "Mapping to criteria": proposed criteria from the JD, inactive until approved. */
export async function mapJdCriteriaStep(roleId: string): Promise<StepResult> {
  const auth = await requireAuth();
  const role = await ownRole(auth, roleId);
  const cur = await currentJd(auth.orgId, roleId);
  if (!cur) return { error: "No uploaded job description found for this role." };
  try {
    const titleFact = await db.extractedField.findFirst({ where: { roleId, orgId: auth.orgId, field: "title", status: "pending" } });
    const title = titleFact ? (JSON.parse(titleFact.valueJson) as string) : role.title;
    const out = await draftJdCriteria(title, cur.pages);
    await storeProposedCriteria(auth.orgId, roleId, out.criteria, out.method === "ai" ? "ai" : "extracted");
    await audit(auth, "jd.criteria_drafted", { subjectType: "role", subjectId: roleId, roleId, meta: { criteria: out.criteria.length, method: out.method } });
    return { ok: true, notice: out.notice, count: out.criteria.length };
  } catch (err) {
    logError("jd.criteria_failed", err, { roleId });
    return { error: "Criteria couldn't be drafted. You can add or draft them on the Criteria tab." };
  }
}

const SCALAR_FIELDS = ["title", "department", "location", "employment_type"] as const;

/** Applies the recruiter-reviewed extraction to the role. Each fact is marked accepted, edited or rejected. */
export async function reviewRoleExtraction(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  const facts = await db.extractedField.findMany({ where: { roleId, orgId: auth.orgId, status: "pending" } });
  const reviewedAt = new Date();
  const update: { title?: string; department?: string; location?: string; employmentType?: string; description?: string } = {};

  for (const field of SCALAR_FIELDS) {
    if (fd.get(`use_${field}`) !== "on") continue;
    const value = str(fd, `value_${field}`, 160);
    if (field === "title") {
      if (!value) return { error: "Title can't be empty. Enter one or untick it." };
      update.title = value;
    } else if (field === "employment_type") {
      const t = z.enum(EMPLOYMENT_TYPES).safeParse(value);
      if (!t.success) return { error: "Choose a valid employment type." };
      update.employmentType = t.data;
    } else update[field] = value;
  }
  if (fd.get("useJdText") === "on") {
    const jd = await db.jobDescription.findFirst({ where: { roleId, orgId: auth.orgId, isCurrent: true } });
    if (jd) update.description = (JSON.parse(jd.pagesJson) as string[]).join("\n\n").slice(0, 30000);
  }

  const ops = facts.map((f) => {
    const original = JSON.parse(f.valueJson) as unknown;
    if ((SCALAR_FIELDS as readonly string[]).includes(f.field)) {
      const used = fd.get(`use_${f.field}`) === "on";
      const value = str(fd, `value_${f.field}`, 160);
      const status = !used ? "rejected" : value === original ? "accepted" : "edited";
      return db.extractedField.update({
        where: { id: f.id },
        data: { status, editedValueJson: status === "edited" ? JSON.stringify(value) : null, reviewedByName: auth.userName, reviewedAt },
      });
    }
    const kept = fd.get(`keep_${f.id}`) === "on";
    const text = str(fd, `text_${f.id}`, 2000);
    const status = !kept ? "rejected" : text === original ? "accepted" : "edited";
    return db.extractedField.update({
      where: { id: f.id },
      data: { status, editedValueJson: status === "edited" ? JSON.stringify(text) : null, reviewedByName: auth.userName, reviewedAt },
    });
  });
  await db.$transaction([...ops, db.role.update({ where: { id: roleId }, data: { ...update, extractionStatus: "reviewed" } })]);
  await audit(auth, "jd.reviewed", { subjectType: "role", subjectId: roleId, roleId, meta: { facts: facts.length } });
  return goTo(`/roles/${roleId}?tab=criteria&saved=details`);
}
