import "server-only";
import type { AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { parseEvidence } from "@/lib/evidence";
import { DEFAULT_BANDS, computeProfileScore, parseBands } from "@/lib/profile-score";

type Actor = Pick<AuthContext, "orgId" | "userId" | "userName">;

/** The role's current scoring version, creating version 1 from the role's weights and the default bands if none exists. */
export async function currentScoringVersion(actor: Actor, roleId: string) {
  const latest = await db.scoringVersion.findFirst({ where: { orgId: actor.orgId, roleId }, orderBy: { version: "desc" } });
  if (latest) return latest;
  const role = await db.role.findFirstOrThrow({ where: { id: roleId, orgId: actor.orgId }, select: { weightRequired: true, weightPreferred: true } });
  return db.scoringVersion.upsert({
    where: { roleId_version: { roleId, version: 1 } },
    update: {},
    create: {
      orgId: actor.orgId,
      roleId,
      version: 1,
      bandsJson: JSON.stringify(DEFAULT_BANDS),
      weightRequired: role.weightRequired,
      weightPreferred: role.weightPreferred,
      createdById: actor.userId,
      createdByName: actor.userName,
      note: "Default bands",
    },
  });
}

/** Creates a new scoring version from the role's current weights and the given bands/coverage. Old scores keep their version. */
export async function newScoringVersion(actor: Actor, roleId: string, change: { bandsJson?: string; minCoverage?: number; note: string }) {
  const cur = await currentScoringVersion(actor, roleId);
  const role = await db.role.findFirstOrThrow({ where: { id: roleId, orgId: actor.orgId }, select: { weightRequired: true, weightPreferred: true } });
  return db.scoringVersion.create({
    data: {
      orgId: actor.orgId,
      roleId,
      version: cur.version + 1,
      bandsJson: change.bandsJson ?? cur.bandsJson,
      minCoverage: change.minCoverage ?? cur.minCoverage,
      weightRequired: role.weightRequired,
      weightPreferred: role.weightPreferred,
      createdById: actor.userId,
      createdByName: actor.userName,
      note: change.note,
    },
  });
}

/** Stores a profile score for one assessment under the role's current scoring version. */
export async function recordProfileScore(actor: Actor, assessmentId: string, trigger: "assessment" | "correction" | "recalculated") {
  const a = await db.assessment.findFirst({
    where: { id: assessmentId, orgId: actor.orgId },
    include: { items: true, application: { select: { id: true, roleId: true, altRoute: true } } },
  });
  if (!a) return null;
  const v = await currentScoringVersion(actor, a.application.roleId);
  const r = computeProfileScore(
    a.items.map((i) => ({ criterionName: i.criterionName, kind: i.kind, importance: i.importance, result: i.result, overrideResult: i.overrideResult, evidenceCount: parseEvidence(i.evidenceJson).filter((e) => e.verified).length })),
    { bands: parseBands(v.bandsJson), weightRequired: v.weightRequired, weightPreferred: v.weightPreferred, minCoverage: v.minCoverage },
  );
  // On the alternative route the screening score isn't used, so none is shown.
  const alt = a.application.altRoute !== "none";
  return db.profileScore.create({
    data: {
      orgId: actor.orgId,
      roleId: a.application.roleId,
      applicationId: a.application.id,
      assessmentId,
      scoringVersionId: v.id,
      score: alt ? null : r.score,
      coverage: r.coverage,
      status: alt ? "alternative" : r.status,
      band: alt ? null : (r.band?.key ?? null),
      bandLabel: alt ? null : (r.band?.label ?? null),
      breakdownJson: JSON.stringify({ method: r.method, rows: r.rows, reason: r.reason, requiredKnown: r.requiredKnown, requiredTotal: r.requiredTotal, generator: a.generator, model: a.model, criteriaVersion: a.criteriaVersion }),
      trigger,
      createdById: actor.userId,
      createdByName: actor.userName,
    },
  });
}
