import "server-only";
import type { AuthContext } from "../auth";
import { loadKitForUser } from "./access";

/**
 * Who may see a stage's recording, transcript and conversation insights:
 * - admins, recruiters, the plan's owner and its named hiring manager: every stage;
 * - an assigned interviewer: their own stages, and every stage once they've submitted all their
 *   scorecards (so other interviews can't shape independent feedback);
 * - nobody else.
 */
export async function transcriptAccess(auth: AuthContext, kitId: string) {
  const k = await loadKitForUser(auth, kitId);
  if (!k) return null;
  const lead = auth.membershipRole === "admin" || auth.membershipRole === "recruiter" || k.kit.ownerId === auth.userId || k.kit.hiringManagerId === auth.userId;
  const myStages = new Set(k.mine.map((a) => a.stageId));
  const canSeeStage = (stageId: string) => lead || myStages.has(stageId) || (k.mine.length > 0 && k.pendingMine.length === 0);
  const canManage = (createdById: string | null) => auth.membershipRole === "admin" || k.kit.ownerId === auth.userId || createdById === auth.userId;
  return { ...k, lead, canSeeStage, canManage, anyAccess: lead || k.mine.length > 0 };
}
