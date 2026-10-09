import "server-only";
import type { AuthContext } from "@/lib/auth";
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
