import "server-only";
import { notFound } from "next/navigation";
import type { AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";

// Ownership checks. Every lookup by id is paired with the caller's orgId so a
// record from another organization behaves exactly like a missing one.

export async function ownRole(auth: AuthContext, id: string) {
  const r = await db.role.findFirst({ where: { id, orgId: auth.orgId } });
  if (!r) notFound();
  return r;
}

export async function ownCandidate(auth: AuthContext, id: string) {
  const c = await db.candidate.findFirst({ where: { id, orgId: auth.orgId } });
  if (!c) notFound();
  return c;
}

export async function ownCriterion(auth: AuthContext, id: string) {
  const c = await db.criterion.findFirst({ where: { id, orgId: auth.orgId } });
  if (!c) notFound();
  return c;
}

export async function ownApplication(auth: AuthContext, id: string) {
  const a = await db.application.findFirst({ where: { id, orgId: auth.orgId } });
  if (!a) notFound();
  return a;
}

export async function ownAssessment(auth: AuthContext, id: string) {
  const a = await db.assessment.findFirst({ where: { id, orgId: auth.orgId } });
  if (!a) notFound();
  return a;
}

export async function ownAssessmentItem(auth: AuthContext, id: string) {
  const i = await db.assessmentItem.findFirst({ where: { id, assessment: { orgId: auth.orgId } }, include: { assessment: true } });
  if (!i) notFound();
  return i;
}

export async function ownResume(auth: AuthContext, id: string) {
  const r = await db.resume.findFirst({ where: { id, orgId: auth.orgId } });
  if (!r) notFound();
  return r;
}

export async function ownNote(auth: AuthContext, id: string) {
  const n = await db.note.findFirst({ where: { id, orgId: auth.orgId } });
  if (!n) notFound();
  return n;
}
