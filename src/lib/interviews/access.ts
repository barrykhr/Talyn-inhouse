import "server-only";
import type { AuthContext } from "../auth";
import { db } from "../db";

/**
 * Interview access, layered on the existing model (every workspace member can see roles and
 * candidates):
 * - A scorecard draft is visible only to its interviewer.
 * - Submitted feedback is visible to workspace members — except an assigned interviewer who
 *   hasn't submitted their own yet, so everyone gives independent feedback first.
 * - The team decision can be recorded by admins, hiring managers, the plan's owner, or the
 *   hiring manager named on the plan.
 */
export async function loadKitForUser(auth: AuthContext, kitId: string) {
  const kit = await db.interviewKit.findFirst({
    where: { id: kitId, orgId: auth.orgId },
    include: {
      application: { include: { candidate: { select: { id: true, fullName: true, currentTitle: true, isSample: true } }, role: { select: { id: true, title: true, criteriaVersion: true } } } },
      competencies: { orderBy: { position: "asc" }, include: { questions: { orderBy: { position: "asc" } } } },
      stages: { orderBy: { position: "asc" }, include: { assignments: { orderBy: { createdAt: "asc" } } } },
    },
  });
  if (!kit) return null;
  const mine = kit.stages.flatMap((s) => s.assignments).filter((a) => a.interviewerId === auth.userId);
  const pendingMine = mine.filter((a) => a.status !== "submitted");
  return {
    kit,
    mine,
    canSeeFeedback: pendingMine.length === 0,
    pendingMine,
    canDecide: auth.membershipRole === "admin" || auth.membershipRole === "hiring_manager" || kit.ownerId === auth.userId || kit.hiringManagerId === auth.userId,
    isOwnerOrAdmin: auth.membershipRole === "admin" || kit.ownerId === auth.userId,
  };
}
