"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import type { ActionState } from "./form";

/**
 * Records a recruiter's decision on a possible duplicate. "linked" notes that both records are the
 * same person; both records, their role applications, assessments, interviews and outreach stay
 * exactly as they are. Any decision can be changed back to "open" (undo).
 */
export async function reviewDuplicate(id: string, status: string, note: string): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole === "hiring_manager") return { error: "Only recruiters and admins can review duplicates." };
  const s = z.enum(["open", "linked", "dismissed", "deferred"]).safeParse(status);
  if (!s.success) return { error: "Choose a decision." };
  const r = await db.duplicateReview.findFirst({ where: { id, orgId: auth.orgId } });
  if (!r) return { error: "That review no longer exists." };
  const reopened = s.data === "open";
  await db.duplicateReview.update({
    where: { id },
    data: {
      status: s.data,
      note: note.trim().slice(0, 500) || null,
      decidedById: reopened ? null : auth.userId,
      decidedByName: reopened ? null : auth.userName,
      decidedAt: reopened ? null : new Date(),
    },
  });
  for (const candidateId of [r.candidateAId, r.candidateBId])
    await audit(auth, "duplicate.reviewed", { subjectType: "candidate", subjectId: id, candidateId, meta: { status: s.data, previous: r.status } });
  revalidatePath("/candidates/duplicates");
  revalidatePath(`/candidates/${r.candidateAId}`);
  revalidatePath(`/candidates/${r.candidateBId}`);
  return { ok: true, message: reopened ? "Decision undone — back to review" : "Decision recorded" };
}
