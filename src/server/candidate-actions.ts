"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECISIONS, STAGES } from "@/lib/domain";
import { logError } from "@/lib/log";
import { extractResume, normalize } from "@/lib/resume";
import { optStr, str, type ActionState } from "./form";
import { ownApplication, ownCandidate, ownNote, ownResume, ownRole } from "./scope";

const CandidateSchema = z.object({
  fullName: z.string().min(1, "Name is required").max(160),
  email: z.string().email("Enter a valid email").max(200).nullable(),
  phone: z.string().max(60).nullable(),
  location: z.string().max(160).nullable(),
  linkedinUrl: z
    .string()
    .max(300)
    .refine((v) => /^https?:\/\//i.test(v), "LinkedIn URL must start with http(s)://")
    .nullable(),
  currentTitle: z.string().max(160).nullable(),
  currentCompany: z.string().max(160).nullable(),
  candidateSummary: z.string().max(20000).nullable(),
});

function parseCandidate(fd: FormData) {
  return CandidateSchema.safeParse({
    fullName: str(fd, "fullName", 160),
    email: optStr(fd, "email", 200)?.toLowerCase() ?? null,
    phone: optStr(fd, "phone", 60),
    location: optStr(fd, "location", 160),
    linkedinUrl: optStr(fd, "linkedinUrl", 300),
    currentTitle: optStr(fd, "currentTitle", 160),
    currentCompany: optStr(fd, "currentCompany", 160),
    candidateSummary: optStr(fd, "candidateSummary", 20000),
  });
}

/** Stores a resume (uploaded file or pasted text) and makes it the candidate's current resume. */
async function storeResume(auth: AuthContext, candidateId: string, fd: FormData): Promise<string | null> {
  const file = fd.get("resume");
  const pasted = str(fd, "resumeText", 100000);
  let record: { fileName: string; mimeType: string; sizeBytes: number; data: Buffer | null; pages: string[] } | null = null;

  if (file instanceof File && file.size > 0) {
    const data = Buffer.from(await file.arrayBuffer());
    const extracted = await extractResume(file.name, data); // throws user-facing errors
    if (extracted.pages.join("").trim().length === 0)
      throw new Error("No text could be read from this file (it may be a scanned image). Paste the resume text instead.");
    record = { fileName: file.name.slice(0, 200), mimeType: extracted.mimeType, sizeBytes: data.length, data, pages: extracted.pages };
  } else if (pasted) {
    record = { fileName: "Pasted resume text", mimeType: "text/plain", sizeBytes: pasted.length, data: null, pages: [normalize(pasted)] };
  }
  if (!record) return null;

  await db.resume.updateMany({ where: { candidateId, orgId: auth.orgId }, data: { isCurrent: false } });
  const r = await db.resume.create({
    data: {
      orgId: auth.orgId,
      candidateId,
      fileName: record.fileName,
      mimeType: record.mimeType,
      sizeBytes: record.sizeBytes,
      hasFile: record.data !== null,
      pagesJson: JSON.stringify(record.pages),
      isCurrent: true,
      ...(record.data ? { file: { create: { orgId: auth.orgId, data: new Uint8Array(record.data) } } } : {}),
    },
  });
  return r.id;
}

function userMessage(err: unknown, fallback: string) {
  if (err instanceof Error && /^(Unsupported|Resume files|The file|No text|This doesn't)/.test(err.message)) return err.message;
  return fallback;
}

export async function createCandidate(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const parsed = parseCandidate(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  const roleId = str(fd, "roleId");
  if (roleId) await ownRole(auth, roleId);

  if (parsed.data.email) {
    const dupe = await db.candidate.findFirst({ where: { orgId: auth.orgId, email: parsed.data.email } });
    if (dupe) return { error: `A candidate with this email already exists (${dupe.fullName}).` };
  }

  const candidate = await db.candidate.create({ data: { ...parsed.data, orgId: auth.orgId, source: "manual" } });
  try {
    await storeResume(auth, candidate.id, fd);
  } catch (err) {
    logError("candidate.resume_failed", err, { candidateId: candidate.id });
    // Keep the candidate; surface the resume problem on their profile.
    redirect(`/candidates/${candidate.id}?resumeError=${encodeURIComponent(userMessage(err, "The resume could not be processed."))}`);
  }
  const note = str(fd, "note", 10000);
  if (note) await db.note.create({ data: { orgId: auth.orgId, candidateId: candidate.id, authorId: auth.userId, authorName: auth.userName, body: note } });
  if (roleId) await attach(auth, candidate.id, roleId);
  redirect(roleId ? `/candidates/${candidate.id}?role=${roleId}` : `/candidates/${candidate.id}`);
}

export async function updateCandidate(id: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  await ownCandidate(auth, id);
  const parsed = parseCandidate(fd);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message };
  if (parsed.data.email) {
    const dupe = await db.candidate.findFirst({ where: { orgId: auth.orgId, email: parsed.data.email, NOT: { id } } });
    if (dupe) return { error: `Another candidate already uses this email (${dupe.fullName}).` };
  }
  await db.candidate.update({ where: { id }, data: parsed.data });
  revalidatePath(`/candidates/${id}`);
  return { ok: true, message: "Saved" };
}

/** Permanently deletes a candidate, their resumes (including original files), notes, applications and assessments. */
export async function deleteCandidate(id: string) {
  const auth = await requireAuth();
  await ownCandidate(auth, id);
  await db.candidate.delete({ where: { id } }); // cascades to resumes, files, notes, applications, assessments
  revalidatePath("/candidates");
  redirect("/candidates");
}

export async function uploadResume(candidateId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  await ownCandidate(auth, candidateId);
  try {
    const id = await storeResume(auth, candidateId, fd);
    if (!id) return { error: "Choose a file or paste resume text." };
  } catch (err) {
    logError("resume.upload_failed", err, { candidateId });
    return { error: userMessage(err, "The resume could not be processed.") };
  }
  revalidatePath(`/candidates/${candidateId}`);
  return { ok: true, message: "Resume saved" };
}

export async function deleteResume(id: string) {
  const auth = await requireAuth();
  const r = await ownResume(auth, id);
  await db.resume.delete({ where: { id } }); // cascades to the stored file
  if (r.isCurrent) {
    const latest = await db.resume.findFirst({ where: { candidateId: r.candidateId, orgId: auth.orgId }, orderBy: { createdAt: "desc" } });
    if (latest) await db.resume.update({ where: { id: latest.id }, data: { isCurrent: true } });
  }
  revalidatePath(`/candidates/${r.candidateId}`);
}

export async function addNote(candidateId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  await ownCandidate(auth, candidateId);
  const body = str(fd, "body", 10000);
  if (!body) return { error: "Write a note first." };
  const roleId = str(fd, "roleId") || null;
  if (roleId) await ownRole(auth, roleId);
  await db.note.create({ data: { orgId: auth.orgId, candidateId, roleId, authorId: auth.userId, authorName: auth.userName, body } });
  revalidatePath(`/candidates/${candidateId}`);
  return { ok: true };
}

export async function deleteNote(id: string) {
  const auth = await requireAuth();
  const n = await ownNote(auth, id);
  await db.note.delete({ where: { id } });
  revalidatePath(`/candidates/${n.candidateId}`);
}

async function attach(auth: AuthContext, candidateId: string, roleId: string) {
  const existing = await db.application.findUnique({ where: { candidateId_roleId: { candidateId, roleId } } });
  if (existing) return existing;
  const app = await db.application.create({ data: { orgId: auth.orgId, candidateId, roleId, stage: "new" } });
  await db.stageEvent.create({ data: { orgId: auth.orgId, applicationId: app.id, fromStage: null, toStage: "new", actorId: auth.userId, actorName: auth.userName } });
  return app;
}

export async function addToRole(candidateId: string, roleId: string) {
  const auth = await requireAuth();
  await ownCandidate(auth, candidateId);
  await ownRole(auth, roleId);
  await attach(auth, candidateId, roleId);
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath(`/roles/${roleId}`);
}

export async function removeFromRole(applicationId: string) {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  await db.application.delete({ where: { id: applicationId } });
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/roles/${app.roleId}`);
}

/** Stage changes are always an explicit recruiter action and are recorded in the history. */
export async function moveStage(applicationId: string, stage: string) {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const to = z.enum(STAGES).parse(stage);
  if (to === app.stage) return;
  await db.$transaction([
    db.application.update({ where: { id: applicationId }, data: { stage: to } }),
    db.stageEvent.create({
      data: { orgId: auth.orgId, applicationId, fromStage: app.stage, toStage: to, actorId: auth.userId, actorName: auth.userName },
    }),
  ]);
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/roles/${app.roleId}`);
}

export async function recordDecision(applicationId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const decision = z.enum(DECISIONS).safeParse(str(fd, "decision"));
  if (!decision.success) return { error: "Choose a decision." };
  const note = str(fd, "decisionNote", 4000);
  if (decision.data === "decline" && !note) return { error: "Add a short, job-related reason when declining." };
  await db.application.update({
    where: { id: applicationId },
    data: { decision: decision.data, decisionNote: note || null, decidedById: auth.userId, decidedByName: auth.userName, decidedAt: new Date() },
  });
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/roles/${app.roleId}`);
  return { ok: true, message: "Decision recorded. Move the pipeline stage when you're ready." };
}
