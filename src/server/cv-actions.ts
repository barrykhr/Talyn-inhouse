"use server";

import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { DocumentParseError } from "@/lib/documents";
import { CORRECTION_REASONS } from "@/lib/domain";
import { logError } from "@/lib/log";
import { goTo, str, type ActionState } from "./form";
import { attach } from "./pipeline";
import { extractIntoReview, parseOrigins, prepareResume, saveResume } from "./resume-store";
import { ownCandidate, ownRole } from "./scope";

export type CvStepResult = { ok?: boolean; error?: string; notice?: string | null; candidateId?: string; applicationId?: string | null; count?: number };

/**
 * Stage 1 — "Uploading": parses the CV first; on failure nothing is created and the recruiter
 * is told why. On success a candidate shell is created (profile empty until review).
 */
export async function uploadCv(fd: FormData): Promise<CvStepResult> {
  const auth = await requireAuth();
  const roleId = str(fd, "roleId");
  if (roleId) await ownRole(auth, roleId);
  let resume;
  try {
    resume = await prepareResume(fd, "cv");
    if (!resume || !resume.data) return { error: "Choose a PDF or DOCX CV to upload." };
  } catch (err) {
    if (err instanceof DocumentParseError) return { error: err.message };
    logError("cv.parse_failed", err);
    return { error: "The CV couldn't be read. Try another file, or enter the details manually." };
  }
  const candidate = await db.candidate.create({
    data: { orgId: auth.orgId, fullName: "Unnamed candidate (CV awaiting review)", source: "cv_upload", extractionStatus: "needs_review" },
  });
  await saveResume(auth, candidate.id, resume);
  const app = roleId ? await attach(auth, candidate.id, roleId) : null;
  await audit(auth, "candidate.created", { subjectType: "candidate", subjectId: candidate.id, candidateId: candidate.id, roleId: roleId || null, meta: { source: "cv_upload", parser: resume.parsed.parserVersion } });
  return { ok: true, candidateId: candidate.id, applicationId: app?.id ?? null };
}

/** Stage 2 — "Extracting information": profile facts from the current CV, pending review. */
export async function extractCvStep(candidateId: string): Promise<CvStepResult> {
  const auth = await requireAuth();
  await ownCandidate(auth, candidateId);
  const resume = await db.resume.findFirst({ where: { candidateId, orgId: auth.orgId, isCurrent: true } });
  if (!resume) return { error: "No CV found for this candidate." };
  try {
    const notice = await extractIntoReview(auth, candidateId, resume.id, JSON.parse(resume.pagesJson) as string[]);
    const count = await db.extractedField.count({ where: { candidateId, orgId: auth.orgId, status: "pending" } });
    await audit(auth, "cv.extracted", { subjectType: "candidate", subjectId: resume.id, candidateId, meta: { facts: count, fallback: !!notice } });
    return { ok: true, notice, count };
  } catch (err) {
    logError("cv.extract_failed", err, { candidateId });
    return { error: "Details couldn't be extracted. The CV is saved — you can fill in the profile yourself." };
  }
}

const SCALARS = {
  full_name: { column: "fullName", max: 160 },
  email: { column: "email", max: 200 },
  phone: { column: "phone", max: 60 },
  location: { column: "location", max: 160 },
  linkedin_url: { column: "linkedinUrl", max: 300 },
  current_title: { column: "currentTitle", max: 160 },
  current_company: { column: "currentCompany", max: 160 },
} as const;
type ScalarField = keyof typeof SCALARS;

const LIST_KEYS: Record<string, string[]> = {
  work_history: ["title", "employer", "start", "end"],
  education: ["institution", "credential", "field"],
  certification: ["name", "issuer"],
  skill: [],
};

/**
 * Applies the recruiter's review of a CV extraction. For each profile field the recruiter
 * either uses the extracted value (origin "cv"), corrects it ("cv_corrected"), types a value
 * the CV didn't contain ("recruiter"), or leaves it unused. Facts are kept with their status.
 */
export async function reviewCvExtraction(candidateId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const candidate = await ownCandidate(auth, candidateId);
  const facts = await db.extractedField.findMany({ where: { candidateId, orgId: auth.orgId, status: "pending" } });
  const byField = new Map(facts.filter((f) => f.field in SCALARS).map((f) => [f.field, f]));
  const origins = parseOrigins(candidate.fieldOriginsJson);
  const update: Record<string, string | null> = {};

  for (const [field, cfg] of Object.entries(SCALARS) as [ScalarField, (typeof SCALARS)[ScalarField]][]) {
    if (fd.get(`use_${field}`) !== "on") continue;
    let value = str(fd, `value_${field}`, cfg.max);
    if (field === "email") {
      value = value.toLowerCase();
      if (value && !z.string().email().safeParse(value).success) return { error: "The email address isn't valid. Correct it or untick it." };
      if (value) {
        const dupe = await db.candidate.findFirst({ where: { orgId: auth.orgId, email: value, NOT: { id: candidateId } } });
        if (dupe) return { error: `Another candidate already uses ${value} (${dupe.fullName}). Untick the email or correct it.` };
      }
    }
    if (field === "linkedin_url" && value && !/^https?:\/\//i.test(value)) return { error: "LinkedIn URL must start with http(s)://" };
    if (field === "full_name" && !value) return { error: "Name can't be empty. Enter it or untick it." };
    update[cfg.column] = value || null;
    const fact = byField.get(field);
    const extracted = fact ? (JSON.parse(fact.valueJson) as string) : null;
    origins[cfg.column] = extracted === null ? "recruiter" : value === extracted ? "cv" : "cv_corrected";
  }
  if (!update.fullName && candidate.source === "cv_upload" && candidate.fullName.startsWith("Unnamed candidate"))
    return { error: "Add the candidate's name before saving." };

  const reviewedAt = new Date();
  const ops = facts.map((f) => {
    let status: string;
    let edited: unknown = null;
    let reasonKey = "";
    if (f.field in SCALARS) {
      const used = fd.get(`use_${f.field}`) === "on";
      const v = str(fd, `value_${f.field}`, 300);
      const original = JSON.parse(f.valueJson) as string;
      status = !used ? "rejected" : (f.field === "email" ? v.toLowerCase() : v) === original ? "accepted" : "edited";
      if (status === "edited") edited = v;
      reasonKey = `reason_${f.field}`;
    } else {
      const keys = LIST_KEYS[f.field] ?? [];
      if (fd.get(`keep_${f.id}`) !== "on") status = "rejected";
      else {
        const original = JSON.parse(f.valueJson) as unknown;
        const value = keys.length ? Object.fromEntries(keys.map((k) => [k, str(fd, `f_${f.id}_${k}`, 200)])) : str(fd, `f_${f.id}_value`, 200);
        status = JSON.stringify(value) === JSON.stringify(original) ? "accepted" : "edited";
        if (status === "edited") edited = value;
        reasonKey = `reason_${f.id}`;
      }
    }
    return db.extractedField.update({
      where: { id: f.id },
      data: {
        status,
        editedValueJson: edited === null ? null : JSON.stringify(edited),
        correctionReason: status === "edited" ? CORRECTION_REASONS.find((r) => r.value === str(fd, reasonKey))?.value ?? null : null,
        reviewedByName: auth.userName,
        reviewedAt,
      },
    });
  });
  await db.$transaction([
    ...ops,
    db.candidate.update({ where: { id: candidateId }, data: { ...update, fieldOriginsJson: JSON.stringify(origins), extractionStatus: "reviewed" } }),
  ]);
  const counts = ops.length;
  await audit(auth, "cv.reviewed", { subjectType: "candidate", subjectId: candidateId, candidateId, meta: { facts: counts } });
  return goTo(`/candidates/${candidateId}?saved=profile`);
}
