"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { str, type ActionState } from "./form";
import { ownApplication } from "./scope";

/**
 * "Gather more information" as a real recruiter task. Creating, completing or cancelling a task
 * never records a hiring decision and never moves the pipeline stage.
 */
export async function createInfoRequest(applicationId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const title = str(fd, "title", 200) || "Gather more information";
  const questions = str(fd, "questions", 4000)
    .split("\n")
    .map((q) => q.replace(/^[-•*\d.)\s]+/, "").trim())
    .filter(Boolean)
    .slice(0, 15);
  const due = str(fd, "dueAt");
  const task = await db.task.create({
    data: {
      orgId: auth.orgId,
      applicationId,
      type: "gather_info",
      title,
      detailsJson: JSON.stringify({ questions, fromRecommendation: fd.get("fromRecommendation") === "1" }),
      dueAt: due ? new Date(due) : null,
      createdById: auth.userId,
      createdByName: auth.userName,
    },
  });
  await audit(auth, "task.created", { subjectType: "application", subjectId: task.id, candidateId: app.candidateId, roleId: app.roleId, applicationId, meta: { type: "gather_info", questions: questions.length } });
  revalidatePath(`/candidates/${app.candidateId}`);
  revalidatePath("/queue");
  return { ok: true, message: "Information request added to your queue" };
}

export async function resolveTask(taskId: string, outcome: "done" | "cancelled", note?: string): Promise<ActionState> {
  const auth = await requireAuth();
  const task = await db.task.findFirst({ where: { id: taskId, orgId: auth.orgId }, include: { application: true } });
  if (!task) return { error: "Task not found." };
  const status = z.enum(["done", "cancelled"]).parse(outcome);
  await db.task.update({
    where: { id: taskId },
    data: { status, resolvedNote: note?.slice(0, 2000) || null, resolvedByName: auth.userName, resolvedAt: new Date() },
  });
  await audit(auth, "task.resolved", {
    subjectType: "application",
    subjectId: taskId,
    candidateId: task.application.candidateId,
    roleId: task.application.roleId,
    applicationId: task.applicationId,
    meta: { type: task.type, status },
  });
  revalidatePath(`/candidates/${task.application.candidateId}`);
  revalidatePath("/queue");
  return { ok: true };
}
