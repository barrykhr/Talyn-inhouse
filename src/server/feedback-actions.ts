"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { FEEDBACK_VERDICTS, type FeedbackVerdict } from "@/lib/feedback";
import type { ActionState } from "./form";
import { ownApplication } from "./scope";

/**
 * Records one person's view on a shortlisted candidate (one per person, latest wins). Advisory only:
 * the recruiter still records the decision, and nothing here changes the stage or decision.
 */
export async function recordHiringFeedback(applicationId: string, verdict: string, comment: string): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  if (!(FEEDBACK_VERDICTS as readonly string[]).includes(verdict)) return { error: "Choose Interested, Not a fit or Question." };
  const text = (comment ?? "").trim().slice(0, 2000);
  if (verdict !== "interested" && !text) return { error: verdict === "question" ? "Write your question for the recruiter." : "Add a short reason so the recruiter knows what's missing." };
  const data = { verdict: verdict as FeedbackVerdict, comment: text, userName: auth.userName };
  await db.hiringFeedback.upsert({
    where: { applicationId_userId: { applicationId, userId: auth.userId } },
    create: { orgId: auth.orgId, applicationId, userId: auth.userId, ...data },
    update: data,
  });
  await audit(auth, "candidate.feedback", { subjectType: "application", subjectId: applicationId, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { verdict } });
  revalidatePath(`/roles/${app.roleId}/review`);
  revalidatePath(`/candidates/${app.candidateId}`);
  return { ok: true, message: "Feedback sent to the recruiter" };
}
