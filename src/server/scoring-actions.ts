"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { BAND_ORDER, validateBands, type Band } from "@/lib/profile-score";
import { normEmail } from "@/lib/duplicates";
import { str, type ActionState } from "./form";
import { ownApplication, ownRole } from "./scope";
import { currentScoringVersion, newScoringVersion, recordProfileScore } from "./scoring-store";

const canManage = (role: string) => role === "admin" || role === "recruiter";

/** Saves a role's score bands and minimum coverage as a new scoring version. Other roles are untouched; old scores keep their version. */
export async function updateScoring(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  if (!canManage(auth.membershipRole)) return { error: "Only recruiters and admins can change scoring." };
  await ownRole(auth, roleId);
  const bands: Band[] = BAND_ORDER.map((key, i) => ({ key, min: i === 0 ? 0 : Number(str(fd, `min_${key}`)), label: str(fd, `label_${key}`, 60) }));
  const err = validateBands(bands);
  if (err) return { error: err };
  const cov = Number(str(fd, "minCoverage"));
  if (!Number.isFinite(cov) || cov < 30 || cov > 100) return { error: "Minimum evidence coverage must be between 30% and 100%." };
  const cur = await currentScoringVersion(auth, roleId);
  if (cur.bandsJson === JSON.stringify(bands) && Math.round(cur.minCoverage * 100) === Math.round(cov)) return { ok: true, message: "No changes." };
  const v = await newScoringVersion(auth, roleId, { bandsJson: JSON.stringify(bands), minCoverage: cov / 100, note: str(fd, "note", 300) || "Bands or coverage changed" });
  await audit(auth, "scoring.changed", { subjectType: "role", subjectId: roleId, roleId, meta: { version: v.version, bands: bands.map((b) => `${b.min}:${b.label}`).join(" | "), minCoverage: cov } });
  revalidatePath(`/roles/${roleId}`);
  return { ok: true, message: `Saved as scoring version ${v.version}. Existing scores keep their version until you recalculate.` };
}

/** Deliberately re-scores every candidate's latest assessment for the role with the current version. Earlier scores are kept. */
export async function recalculateScores(roleId: string): Promise<ActionState> {
  const auth = await requireAuth();
  if (!canManage(auth.membershipRole)) return { error: "Only recruiters and admins can recalculate scores." };
  await ownRole(auth, roleId);
  const v = await currentScoringVersion(auth, roleId);
  const apps = await db.application.findMany({ where: { orgId: auth.orgId, roleId }, select: { assessments: { orderBy: { createdAt: "desc" }, take: 1, select: { id: true } } } });
  let n = 0;
  for (const a of apps) if (a.assessments[0]) (await recordProfileScore(auth, a.assessments[0].id, "recalculated")) && n++;
  await audit(auth, "scoring.recalculated", { subjectType: "role", subjectId: roleId, roleId, meta: { version: v.version, scored: n } });
  revalidatePath(`/roles/${roleId}`);
  return { ok: true, message: `${n} score${n === 1 ? "" : "s"} recalculated with version ${v.version}. Earlier scores are kept in history.` };
}

/** Alternative assessment route for a candidate. Never asks for or stores the reason (e.g. disability). */
export async function setAltRoute(applicationId: string, status: string, note: string): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const s = z.enum(["none", "requested", "in_progress", "completed"]).safeParse(status);
  if (!s.success) return { error: "Choose a status." };
  await db.application.update({ where: { id: applicationId }, data: { altRoute: s.data, altRouteNote: note.trim().slice(0, 300) || null, altRouteBy: auth.userName, altRouteAt: new Date() } });
  const latest = await db.assessment.findFirst({ where: { applicationId, orgId: auth.orgId }, orderBy: { createdAt: "desc" }, select: { id: true } });
  if (latest) await recordProfileScore(auth, latest.id, "correction");
  await audit(auth, "candidate.alt_route", { subjectType: "application", subjectId: applicationId, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { status: s.data } });
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath(`/roles/${app.roleId}`);
  return { ok: true };
}

/** Admin review of a scoring version flagged by monitoring. */
export async function reviewScoringFlag(versionId: string, note: string): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can review flags." };
  const v = await db.scoringVersion.findFirst({ where: { id: versionId, orgId: auth.orgId } });
  if (!v) return { error: "Version not found." };
  if (note.trim().length < 10) return { error: "Describe what was reviewed and decided (at least a sentence)." };
  await db.scoringVersion.update({ where: { id: versionId }, data: { flagReviewedAt: new Date(), flagReviewedBy: auth.userName, flagNote: note.trim().slice(0, 1000) } });
  await audit(auth, "scoring.flag_reviewed", { subjectType: "role", subjectId: v.roleId, roleId: v.roleId, meta: { version: v.version } });
  revalidatePath("/settings/scoring");
  return { ok: true, message: "Review recorded." };
}

export async function setAccommodationText(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can change this." };
  await db.organization.update({ where: { id: auth.orgId }, data: { accommodationText: str(fd, "accommodationText", 1000) } });
  revalidatePath("/settings");
  return { ok: true, message: "Saved." };
}

/** Turns aggregate monitoring with self-reported data on or off. Requires the admin's attestation. */
export async function setDemographicMonitoring(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can change this." };
  const enable = fd.get("enable") === "1";
  if (enable && fd.get("attest") !== "on") return { error: "Confirm the attestation to turn this on." };
  await db.organization.update({
    where: { id: auth.orgId },
    data: { demographicMonitoring: enable, demographicAttestedBy: enable ? auth.userName : null, demographicAttestedAt: enable ? new Date() : null },
  });
  await audit(auth, "fairness.monitoring_changed", { subjectType: "org", subjectId: auth.orgId, meta: { enabled: enable } });
  revalidatePath("/settings/scoring");
  return { ok: true, message: enable ? "Monitoring turned on." : "Monitoring turned off. Stored responses are kept until you delete them." };
}

/** Imports self-reported responses as CSV lines: email,category,value. Matched by candidate email only; never inferred. */
export async function importDemographics(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can do this." };
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { demographicMonitoring: true } });
  if (!org.demographicMonitoring) return { error: "Turn on monitoring (with the attestation) first." };
  const lines = str(fd, "csv", 200000).split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const rows = lines.filter((l) => !/^email\s*,/i.test(l)).map((l) => l.split(",").map((x) => x.trim()));
  const cands = await db.candidate.findMany({ where: { orgId: auth.orgId, email: { not: null } }, select: { id: true, email: true } });
  const byEmail = new Map(cands.map((c) => [normEmail(c.email), c.id]));
  let saved = 0;
  let unmatched = 0;
  for (const [email, category, value] of rows) {
    const id = byEmail.get(normEmail(email));
    if (!id || !category || !value) {
      unmatched++;
      continue;
    }
    const cat = category.toLowerCase().slice(0, 40);
    await db.demographicRecord.upsert({
      where: { candidateId_category: { candidateId: id, category: cat } },
      update: { value: value.slice(0, 80), createdByName: auth.userName },
      create: { orgId: auth.orgId, candidateId: id, category: cat, value: value.slice(0, 80), createdByName: auth.userName },
    });
    saved++;
  }
  await audit(auth, "fairness.data_imported", { subjectType: "org", subjectId: auth.orgId, meta: { saved, unmatched } });
  revalidatePath("/settings/scoring");
  return { ok: true, message: `${saved} response${saved === 1 ? "" : "s"} stored${unmatched ? ` · ${unmatched} line${unmatched === 1 ? "" : "s"} not matched to a candidate email or incomplete` : ""}.` };
}

export async function deleteDemographics(): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can do this." };
  const { count } = await db.demographicRecord.deleteMany({ where: { orgId: auth.orgId } });
  await audit(auth, "fairness.data_deleted", { subjectType: "org", subjectId: auth.orgId, meta: { deleted: count } });
  revalidatePath("/settings/scoring");
  return { ok: true, message: `${count} stored responses deleted.` };
}
