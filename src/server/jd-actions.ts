"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { DocumentParseError, parseDocument } from "@/lib/documents";
import { EMPLOYMENT_TYPES } from "@/lib/domain";
import { extractJobDescription } from "@/lib/extraction";
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

/** Stores the JD, extracts details and proposes criteria. Nothing is applied to the role until reviewed. */
async function ingestJd(auth: AuthContext, roleId: string, upload: Awaited<ReturnType<typeof readUpload>>) {
  await db.jobDescription.updateMany({ where: { roleId, orgId: auth.orgId }, data: { isCurrent: false } });
  const jd = await db.jobDescription.create({
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
  const extraction = await extractJobDescription(upload.parsed.pages);
  await storeFacts(auth.orgId, { type: "role", roleId }, jd.id, extraction.facts);
  await storeProposedCriteria(auth.orgId, roleId, extraction.criteria, extraction.method === "ai" ? "ai" : "extracted");
  await db.role.update({ where: { id: roleId }, data: { extractionStatus: "needs_review" } });
  return extraction.notice;
}

export async function createRoleFromJd(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  let upload;
  try {
    upload = await readUpload(fd);
  } catch (err) {
    if (err instanceof DocumentParseError) return { error: err.message };
    logError("jd.parse_failed", err);
    return { error: "The file couldn't be read. Try again, or enter the role details manually." };
  }
  // The JD text is the source document, so it becomes the role description. Extracted
  // details (title, department, …) wait for recruiter review.
  const role = await db.role.create({
    data: {
      orgId: auth.orgId,
      title: `Untitled role (from ${upload.file.name.replace(/\.[^.]+$/, "").slice(0, 80)})`,
      description: upload.parsed.pages.join("\n\n").slice(0, 30000),
      status: "draft",
      createdById: auth.userId,
    },
  });
  let notice: string | null = null;
  try {
    notice = await ingestJd(auth, role.id, upload);
  } catch (err) {
    logError("jd.ingest_failed", err, { roleId: role.id });
    notice = "The JD was saved, but details couldn't be extracted. Enter them manually.";
  }
  return goTo(`/roles/${role.id}?tab=description${notice ? `&notice=${encodeURIComponent(notice)}` : ""}`);
}

export async function uploadJdToRole(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  let notice: string | null;
  try {
    notice = await ingestJd(auth, roleId, await readUpload(fd));
  } catch (err) {
    if (err instanceof DocumentParseError) return { error: err.message };
    logError("jd.upload_failed", err, { roleId });
    return { error: "The JD couldn't be processed. Please try again." };
  }
  revalidatePath(`/roles/${roleId}`);
  return { ok: true, message: notice ?? "JD uploaded. Review the extracted details below." };
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
  return goTo(`/roles/${roleId}?tab=criteria&saved=details`);
}
