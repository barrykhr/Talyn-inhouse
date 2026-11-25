"use server";

import { revalidatePath } from "next/cache";
import { AiRequestError, AiUnavailableError, aiStatus, roleInsightsWithAi } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import { cleanTitles, mergeChecks, ruleChecks, verifyChecks, type InsightCheck } from "@/lib/role-insights";
import type { ActionState } from "./form";
import { ownRole } from "./scope";

/**
 * Checks the role's current JD for vague, conflicting, exclusionary or missing points and suggests
 * the usual career path. The rule-based exclusionary check always runs; the AI part runs when AI is
 * configured. Results are suggestions for the recruiter; nothing about the role changes.
 */
export async function generateRoleInsights(roleId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const role = await ownRole(auth, roleId);
  const [jd, criteria] = await Promise.all([
    db.jobDescription.findFirst({ where: { roleId, orgId: auth.orgId, isCurrent: true }, orderBy: { createdAt: "desc" }, select: { fileName: true, pagesJson: true } }),
    db.criterion.findMany({ where: { roleId, orgId: auth.orgId, status: "approved" }, select: { name: true }, orderBy: { position: "asc" }, take: 30 }),
  ]);
  let jdText = "";
  try {
    jdText = jd ? (JSON.parse(jd.pagesJson) as string[]).join("\n") : "";
  } catch {
    jdText = "";
  }
  if (!jdText.trim()) jdText = role.description;
  if (!jdText.trim()) return { error: "Upload a job description (or add a role description) first. The check reads its wording." };

  const rules = ruleChecks(jdText);
  let checks: InsightCheck[] = rules;
  let growth: { from_titles: string[]; next_titles: string[]; note: string } | null = null;
  let model = "rules";
  let notice: string | undefined;
  const ai = aiStatus();
  if (ai.configured) {
    try {
      const out = await roleInsightsWithAi({ title: role.title, jdText, criteria: criteria.map((c) => c.name), location: role.location || null });
      checks = mergeChecks(rules, verifyChecks(out.checks, jdText));
      growth = { from_titles: cleanTitles(out.growth.from_titles, 5), next_titles: cleanTitles(out.growth.next_titles, 4), note: out.growth.note.slice(0, 300) };
      model = `${ai.provider}:${ai.model}`;
    } catch (err) {
      if (!(err instanceof AiRequestError || err instanceof AiUnavailableError)) logError("role_insights.failed", err, { roleId });
      notice = `${err instanceof AiRequestError ? err.message : "The AI check couldn't run."} Showing the rule-based check only.`;
    }
  } else notice = "AI is off: showing the rule-based check for exclusionary wording only.";

  const data = { checksJson: JSON.stringify(checks), growthJson: growth ? JSON.stringify(growth) : null, model, jdFileName: jd?.fileName ?? null, generatedByName: auth.userName, generatedAt: new Date() };
  await db.roleInsight.upsert({ where: { roleId }, create: { orgId: auth.orgId, roleId, ...data }, update: data });
  await audit(auth, "role.insights_generated", { subjectType: "role", subjectId: roleId, roleId, meta: { checks: checks.length, ai: model !== "rules" } });
  revalidatePath(`/roles/${roleId}`);
  return { ok: true, message: notice ?? `Checked the JD: ${checks.length ? `${checks.length} point${checks.length === 1 ? "" : "s"} to review` : "nothing to flag"}.` };
}
