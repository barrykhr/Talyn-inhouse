import "server-only";
import type { AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";

/** Adds a candidate to a role pipeline at "New" (idempotent), recording the stage event. */
export async function attach(auth: AuthContext, candidateId: string, roleId: string) {
  const existing = await db.application.findUnique({ where: { candidateId_roleId: { candidateId, roleId } } });
  if (existing) return existing;
  const app = await db.application.create({ data: { orgId: auth.orgId, candidateId, roleId, stage: "new" } });
  await db.stageEvent.create({ data: { orgId: auth.orgId, applicationId: app.id, fromStage: null, toStage: "new", actorId: auth.userId, actorName: auth.userName } });
  return app;
}
