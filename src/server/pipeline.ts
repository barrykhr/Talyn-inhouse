import "server-only";
import type { AuthContext } from "@/lib/auth";
import { queueStageChange } from "@/lib/ats/sync";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";

export type Origin = { origin: "applied" | "discovered"; detail?: string | null; sourcedProfileId?: string | null };

/**
 * Adds a candidate to a role pipeline at "New" (idempotent), recording the stage event.
 * An existing application keeps its origin: an applicant never becomes "discovered" or vice versa.
 */
export async function attach(auth: AuthContext, candidateId: string, roleId: string, origin: Origin = { origin: "applied" }) {
  const existing = await db.application.findUnique({ where: { candidateId_roleId: { candidateId, roleId } } });
  if (existing) return existing;
  const app = await db.application.create({
    data: { orgId: auth.orgId, candidateId, roleId, stage: "new", origin: origin.origin, originDetail: origin.detail ?? null, sourcedProfileId: origin.sourcedProfileId ?? null },
  });
  await db.stageEvent.create({ data: { orgId: auth.orgId, applicationId: app.id, fromStage: null, toStage: "new", actorId: auth.userId, actorName: auth.userName } });
  return app;
}

/**
 * Moves an application to a stage as the given recruiter: records the stage event, audits it and
 * queues the ATS update (a no-op unless an ATS is connected, linked and mapped). Callers make sure
 * this is an explicit recruiter choice. Returns false when the stage was already set.
 */
export async function moveStageAs(
  auth: AuthContext,
  app: { id: string; stage: string; candidateId: string; roleId: string; atsExternalId: string | null },
  to: string,
) {
  if (to === app.stage) return false;
  await db.$transaction([
    db.application.update({ where: { id: app.id }, data: { stage: to } }),
    db.stageEvent.create({ data: { orgId: auth.orgId, applicationId: app.id, fromStage: app.stage, toStage: to, actorId: auth.userId, actorName: auth.userName } }),
  ]);
  await audit(auth, "stage.changed", { subjectType: "application", subjectId: app.id, candidateId: app.candidateId, roleId: app.roleId, applicationId: app.id, meta: { from: app.stage, to } });
  await queueStageChange(auth, app, to);
  return true;
}
