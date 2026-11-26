"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, FAIRNESS_RULES, aiStatus, runStructuredFor } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import { reasonsByVerdict, readyToLearn, type Vote } from "@/lib/loop/calibration";
import { criterionFairnessIssue } from "@/lib/profile-score";
import { companyMemory } from "./company-memory";
import { goTo, type ActionState } from "./form";

const path = (roleId: string) => revalidatePath(`/roles/${roleId}/calibrate`);

/** Starts a calibration round with 3–8 profiles the recruiter picked. */
export async function startCalibration(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const role = await db.role.findFirst({ where: { id: roleId, orgId: auth.orgId }, select: { id: true } });
  if (!role) return { error: "Role not found." };
  const picks = fd.getAll("pick").map(String).slice(0, 8);
  if (picks.length < 3) return { error: "Pick at least 3 profiles, ideally a mix of strong and borderline ones." };
  const appIds = picks.filter((p) => p.startsWith("application:")).map((p) => p.slice(12));
  const srcIds = picks.filter((p) => p.startsWith("sourced:")).map((p) => p.slice(8));
  const [apps, srcs] = await Promise.all([
    db.application.findMany({
      where: { id: { in: appIds }, orgId: auth.orgId, roleId },
      select: {
        id: true,
        candidate: { select: { fullName: true, currentTitle: true, currentCompany: true } },
        assessments: { orderBy: { createdAt: "desc" }, take: 1, select: { items: { select: { criterionName: true, importance: true, result: true, overrideResult: true } } } },
      },
    }),
    db.sourcedProfile.findMany({ where: { id: { in: srcIds }, orgId: auth.orgId, roleId }, select: { id: true, displayName: true, currentTitle: true, currentCompany: true, aiFitJson: true, signalsJson: true } }),
  ]);
  const items = [
    ...apps.map((a) => {
      const its = a.assessments[0]?.items ?? [];
      const r = (i: (typeof its)[number]) => i.overrideResult ?? i.result;
      const shows = its.filter((i) => r(i) === "supported").map((i) => i.criterionName);
      const gaps = its.filter((i) => i.importance === "essential" && r(i) !== "supported").map((i) => i.criterionName);
      return {
        kind: "application",
        refId: a.id,
        name: a.candidate.fullName,
        headline: [a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(" · "),
        summary: its.length ? [shows.length ? `Shows: ${shows.slice(0, 5).join(", ")}` : "", gaps.length ? `Not shown: ${gaps.slice(0, 4).join(", ")}` : ""].filter(Boolean).join(". ") : "Not assessed yet",
      };
    }),
    ...srcs.map((p) => {
      const fit = p.aiFitJson ? (JSON.parse(p.aiFitJson) as { summary?: string }) : null;
      const matched = (JSON.parse(p.signalsJson) as { term: string; matched: boolean }[]).filter((s) => s.matched).map((s) => s.term);
      return { kind: "sourced", refId: p.id, name: p.displayName, headline: [p.currentTitle, p.currentCompany].filter(Boolean).join(" · "), summary: fit?.summary || (matched.length ? `Evidence for: ${matched.slice(0, 6).join(", ")}` : "Found in Discover") };
    }),
  ];
  if (items.length < 3) return { error: "Some picks weren't found. Pick at least 3." };
  await db.calibrationRound.updateMany({ where: { orgId: auth.orgId, roleId, status: "open" }, data: { status: "closed" } });
  const round = await db.calibrationRound.create({ data: { orgId: auth.orgId, roleId, createdByName: auth.userName, items: { create: items.map((it, i) => ({ ...it, position: i })) } } });
  await audit(auth, "calibration.started", { subjectType: "role", subjectId: round.id, roleId, meta: { profiles: items.length } });
  return goTo(`/roles/${roleId}/calibrate`);
}

/** One person's reaction to one profile. Anyone on the workspace can vote; votes never move anyone. */
export async function voteCalibration(itemId: string, verdict: string, reason: string): Promise<ActionState> {
  const auth = await requireAuth();
  const v = z.enum(["yes", "no", "unsure"]).safeParse(verdict);
  if (!v.success) return { error: "Choose an answer." };
  const item = await db.calibrationItem.findFirst({ where: { id: itemId, round: { orgId: auth.orgId } }, select: { id: true, round: { select: { roleId: true, status: true } } } });
  if (!item) return { error: "Not found." };
  if (item.round.status !== "open") return { error: "This round is closed." };
  const text = reason.trim().slice(0, 400);
  if (v.data !== "unsure" && text.length < 5) return { error: "Add a short reason. The reason is what sharpens the brief." };
  await db.calibrationVote.upsert({
    where: { itemId_userId: { itemId, userId: auth.userId } },
    create: { itemId, userId: auth.userId, userName: auth.userName, verdict: v.data, reason: text },
    update: { verdict: v.data, reason: text, userName: auth.userName },
  });
  path(item.round.roleId);
  revalidatePath("/inbox");
  return { ok: true };
}

export async function closeCalibration(roundId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const r = await db.calibrationRound.findFirst({ where: { id: roundId, orgId: auth.orgId }, select: { id: true, roleId: true } });
  if (!r) return { error: "Not found." };
  await db.calibrationRound.update({ where: { id: r.id }, data: { status: "closed" } });
  path(r.roleId);
  revalidatePath("/inbox");
  return { ok: true, message: "Round closed. Its reasons stay in the company's hiring memory." };
}

// ---------- Learning from the votes ----------

const Suggestions = z.object({
  suggestions: z.array(
    z.object({
      type: z.enum(["add", "make_must_have", "change_importance", "clarify", "remove"]),
      criterion_id: z.string().describe("For changes to an existing criterion: its id. Empty for add."),
      name: z.string().describe("Criterion name (new or existing)"),
      description: z.string().describe("For add or clarify: the wording to use"),
      importance: z.enum(["essential", "preferred"]).describe("For add or change_importance"),
      why: z.string().describe("One or two sentences citing what the hiring manager said"),
      profiles: z.array(z.string()).describe("Names of the profiles whose votes support this"),
    }),
  ),
});

export async function suggestFromCalibration(roundId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const ai = aiStatus();
  if (!ai.configured) return { error: "AI is off for this workspace." };
  const round = await db.calibrationRound.findFirst({ where: { id: roundId, orgId: auth.orgId }, include: { items: { include: { votes: true } }, role: { include: { criteria: { where: { status: "approved" } } } } } });
  if (!round) return { error: "Not found." };
  const items = round.items.map((i) => ({ name: i.name, headline: i.headline, summary: i.summary, votes: i.votes.map((v) => ({ verdict: v.verdict, reason: v.reason, userName: v.userName }) as Vote) }));
  if (!readyToLearn(items)) return { error: "Get at least 3 profiles voted on, with at least one reason, first." };
  const memory = await companyMemory(auth.orgId, auth.orgName, round.roleId);
  const byV = reasonsByVerdict(items);
  const system = `You help a recruiter sharpen a role's hiring criteria from a hiring manager's reactions to real candidate profiles. Suggest concrete changes to the criteria that would make the brief match what the hiring manager actually wants. The recruiter decides; these are suggestions.
- Base every suggestion on the votes and reasons given (and the company's past hiring notes if relevant). Cite which profiles support it.
- add: a criterion the hiring manager clearly cares about that's missing. make_must_have: an existing criterion they treat as non-negotiable. change_importance: an existing criterion they weigh differently. clarify: an existing criterion whose wording should be sharper. remove: one they clearly don't care about.
- Never suggest criteria about protected characteristics, age, years since graduation, nationality, family, health, appearance, school prestige as a proxy, or "culture fit". If a reason relies on one, ignore it.
- At most 6 suggestions. None is fine if the votes already match the criteria.
${FAIRNESS_RULES}`;
  const user = `Role: ${round.role.title}

<criteria>
${round.role.criteria.map((c) => `- id: ${c.id} · ${c.name} (${c.importance}${c.mustHave ? ", must-have" : ""})${c.description ? ` — ${c.description}` : ""}`).join("\n")}
</criteria>

<profiles_and_votes>
${items.map((i) => `- ${i.name} (${i.headline || "no headline"}): ${i.summary}\n  votes: ${i.votes.map((v) => `${v.verdict}${v.reason ? ` — "${v.reason}"` : ""}`).join("; ") || "none"}`).join("\n")}
</profiles_and_votes>

<summary>
Would meet: ${byV.yes.length} reasons · Wouldn't meet: ${byV.no.length} · Not sure: ${byV.unsure.length}
</summary>

<company_hiring_memory>
${memory.length ? memory.map((m) => `- ${m}`).join("\n") : "(none yet)"}
</company_hiring_memory>`;
  try {
    const r = await runStructuredFor({ system, user, schema: Suggestions, name: "calibration_suggestions", maxTokens: 4000 });
    const ids = new Set(round.role.criteria.map((c) => c.id));
    const clean = r.suggestions
      .filter((s) => (s.type === "add" ? true : ids.has(s.criterion_id)))
      .filter((s) => !criterionFairnessIssue(s.name, s.description))
      .slice(0, 6);
    await db.calibrationRound.update({ where: { id: round.id }, data: { suggestionsJson: JSON.stringify(clean), suggestedAt: new Date() } });
  } catch (err) {
    if (!(err instanceof AiRequestError || err instanceof AiUnavailableError)) logError("calibration.suggest_failed", err, { roundId });
    return { error: err instanceof AiRequestError ? err.message : "Couldn't write suggestions. Try again." };
  }
  await audit(auth, "calibration.suggested", { subjectType: "role", subjectId: round.id, roleId: round.roleId });
  path(round.roleId);
  return { ok: true, message: "Suggestions ready. Nothing changes until you approve it." };
}

/** Adds a suggested new criterion as a proposal, for the usual approval on the Criteria tab. */
export async function proposeFromCalibration(roundId: string, index: number): Promise<ActionState> {
  const auth = await requireAuth();
  const round = await db.calibrationRound.findFirst({ where: { id: roundId, orgId: auth.orgId }, select: { id: true, roleId: true, suggestionsJson: true } });
  if (!round?.suggestionsJson) return { error: "Not found." };
  const s = (JSON.parse(round.suggestionsJson) as z.infer<typeof Suggestions>["suggestions"]).at(index);
  if (!s || s.type !== "add") return { error: "Only new criteria can be added this way." };
  const fair = criterionFairnessIssue(s.name, s.description);
  if (fair) return { error: fair };
  const last = await db.criterion.findFirst({ where: { roleId: round.roleId }, orderBy: { position: "desc" }, select: { position: true } });
  await db.criterion.create({
    data: { orgId: auth.orgId, roleId: round.roleId, name: s.name.slice(0, 200), description: s.description.slice(0, 1000), importance: s.importance, kind: "criterion", origin: "ai", rationale: `From calibration: ${s.why}`.slice(0, 1000), status: "proposed", position: (last?.position ?? 0) + 1 },
  });
  await audit(auth, "calibration.criterion_proposed", { subjectType: "role", subjectId: round.id, roleId: round.roleId });
  revalidatePath(`/roles/${round.roleId}`);
  path(round.roleId);
  return { ok: true, message: "Added as a suggestion on the Criteria tab. It isn't used until you approve it." };
}
