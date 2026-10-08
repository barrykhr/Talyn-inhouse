"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { DECISIONS, STAGES } from "@/lib/domain";
import { logError } from "@/lib/log";
import { DocumentParseError } from "@/lib/documents";
import { goTo, optStr, str, type ActionState } from "./form";
import { attach } from "./pipeline";
import { extractIntoReview, parseOrigins, prepareResume, saveResume } from "./resume-store";
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

const PROFILE_FIELDS = ["fullName", "email", "phone", "location", "linkedinUrl", "currentTitle", "currentCompany", "candidateSummary"] as const;

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
  // Read the resume BEFORE creating anything, so a bad file never leaves a half-created record.
  let resume;
  try {
    resume = await prepareResume(fd);
  } catch (err) {
    if (err instanceof DocumentParseError) return { error: `Resume: ${err.message} Your other entries are kept — remove the file or try another.` };
    logError("candidate.resume_failed", err);
    return { error: "The resume couldn't be read. Your entries are kept — remove the file or try another." };
  }

  // Everything typed into this form is recruiter-entered.
  const origins = Object.fromEntries(PROFILE_FIELDS.filter((f) => parsed.data[f]).map((f) => [f, "recruiter"]));
  const candidate = await db.candidate.create({
    data: { ...parsed.data, orgId: auth.orgId, source: "manual", fieldOriginsJson: JSON.stringify(origins) },
  });
  if (resume) await saveResume(auth, candidate.id, resume);
  const note = str(fd, "note", 10000);
  if (note) await db.note.create({ data: { orgId: auth.orgId, candidateId: candidate.id, authorId: auth.userId, authorName: auth.userName, body: note } });
  if (roleId) await attach(auth, candidate.id, roleId);
  await audit(auth, "candidate.created", { subjectType: "candidate", subjectId: candidate.id, candidateId: candidate.id, roleId: roleId || null, meta: { source: "manual", resume: !!resume } });
  return goTo(roleId ? `/candidates/${candidate.id}?role=${roleId}` : `/candidates/${candidate.id}`);
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
  // Any field the recruiter changes here becomes recruiter-entered.
  const current = await db.candidate.findFirstOrThrow({ where: { id, orgId: auth.orgId } });
  const origins = parseOrigins(current.fieldOriginsJson);
  for (const f of PROFILE_FIELDS) if ((current[f] ?? null) !== (parsed.data[f] ?? null)) origins[f] = "recruiter";
  await db.candidate.update({ where: { id }, data: { ...parsed.data, fieldOriginsJson: JSON.stringify(origins) } });
  await audit(auth, "candidate.updated", { subjectType: "candidate", subjectId: id, candidateId: id });
  revalidatePath(`/candidates/${id}`);
  return { ok: true, message: "Saved" };
}

/** Permanently deletes a candidate, their resumes (including original files), notes, applications and assessments. */
export async function deleteCandidate(id: string) {
  const auth = await requireAuth();
  await ownCandidate(auth, id);
  await db.candidate.delete({ where: { id } }); // cascades to resumes, files, notes, applications, assessments
  // The audit trail keeps only the candidate id (no personal data) as evidence of deletion.
  await audit(auth, "candidate.deleted", { subjectType: "candidate", subjectId: id, candidateId: id });
  return goTo("/candidates");
}

/** Stores a new resume version, then extracts its details into a pending review. */
export async function uploadResume(candidateId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  await ownCandidate(auth, candidateId);
  let resume;
  try {
    resume = await prepareResume(fd);
    if (!resume) return { error: "Choose a file or paste resume text." };
  } catch (err) {
    if (err instanceof DocumentParseError) return { error: err.message };
    logError("resume.upload_failed", err, { candidateId });
    return { error: "The resume couldn't be read. Please try another file." };
  }
  const saved = await saveResume(auth, candidateId, resume);
  let notice: string | null = null;
  try {
    notice = await extractIntoReview(auth, candidateId, saved.id, resume.parsed.pages);
  } catch (err) {
    logError("resume.extract_failed", err, { candidateId });
    notice = "Resume saved, but details couldn't be extracted. You can still assess and edit the profile manually.";
  }
  await audit(auth, "resume.uploaded", { subjectType: "candidate", subjectId: saved.id, candidateId, meta: { parser: resume.parsed.parserVersion } });
  revalidatePath(`/candidates/${candidateId}`);
  return { ok: true, message: notice ?? "Resume saved. Review the extracted details above." };
}

/** Runs extraction on the current resume (e.g. one added manually or via CSV). */
export async function extractFromCurrentResume(candidateId: string): Promise<ActionState> {
  const auth = await requireAuth();
  await ownCandidate(auth, candidateId);
  const resume = await db.resume.findFirst({ where: { candidateId, orgId: auth.orgId, isCurrent: true } });
  if (!resume) return { error: "Add a resume first." };
  try {
    const notice = await extractIntoReview(auth, candidateId, resume.id, JSON.parse(resume.pagesJson) as string[]);
    revalidatePath(`/candidates/${candidateId}`);
    return { ok: true, message: notice ?? undefined };
  } catch (err) {
    logError("resume.extract_failed", err, { candidateId });
    return { error: "Details couldn't be extracted. Please try again." };
  }
}

export async function deleteResume(id: string) {
  const auth = await requireAuth();
  const r = await ownResume(auth, id);
  await db.resume.delete({ where: { id } }); // cascades to the stored file
  await audit(auth, "resume.deleted", { subjectType: "candidate", subjectId: id, candidateId: r.candidateId });
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

export async function addToRole(candidateId: string, roleId: string) {
  const auth = await requireAuth();
  await ownCandidate(auth, candidateId);
  await ownRole(auth, roleId);
  const added = await attach(auth, candidateId, roleId);
  await audit(auth, "candidate.added_to_role", { subjectType: "application", subjectId: added.id, candidateId, roleId, applicationId: added.id });
  revalidatePath(`/candidates/${candidateId}`);
  revalidatePath(`/roles/${roleId}`);
}

export async function removeFromRole(applicationId: string) {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  await db.application.delete({ where: { id: applicationId } });
  await audit(auth, "candidate.removed_from_role", { subjectType: "application", subjectId: applicationId, candidateId: app.candidateId, roleId: app.roleId });
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
  await audit(auth, "stage.changed", { subjectType: "application", subjectId: applicationId, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { from: app.stage, to } });
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
  await audit(auth, "decision.recorded", { subjectType: "application", subjectId: applicationId, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { decision: decision.data } });
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/roles/${app.roleId}`);
  return { ok: true, message: "Decision recorded. Move the pipeline stage when you're ready." };
}
