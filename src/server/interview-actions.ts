"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, INTERVIEW_KIT_VERSION, aiStatus, generateInterviewKitWithAi } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { loadKitForUser } from "@/lib/interviews/access";
import { DECISIONS, RATING_LEVELS, defaultAnchors, parseEntries, type ScoreEntry } from "@/lib/interviews/rubric";
import { logError } from "@/lib/log";
import { goTo, str, type ActionState } from "./form";
import { ownApplication } from "./scope";

type Ok = ActionState;
const refresh = (kitId: string, roleId?: string, candidateId?: string) => {
  revalidatePath(`/interviews/${kitId}`);
  revalidatePath(`/interviews/${kitId}/debrief`);
  revalidatePath("/interviews");
  if (roleId) revalidatePath(`/roles/${roleId}/interviews`);
  if (candidateId) revalidatePath(`/candidates/${candidateId}`);
};

async function kitOr(auth: AuthContext, kitId: string) {
  const k = await db.interviewKit.findFirst({ where: { id: kitId, orgId: auth.orgId } });
  return k;
}
/** Competencies or stages with submitted ratings can't be removed — that would erase evidence. */
async function submittedFor(kitId: string) {
  const subs = await db.interviewAssignment.findMany({ where: { kitId, status: "submitted" }, select: { entriesJson: true, stageId: true } });
  return { competencyIds: new Set(subs.flatMap((s) => parseEntries(s.entriesJson).filter((e) => e.rating || e.notAssessed).map((e) => e.competencyId))), stageIds: new Set(subs.map((s) => s.stageId)) };
}

const TEMPLATE_QUESTIONS = (name: string) => [
  { text: `Tell me about a recent situation where you needed ${lc(name)}. What did you do, and what was the result?`, followUps: "What was your specific contribution?\nWhat would you do differently now?", guidance: `Look for a specific example showing ${lc(name)}: the situation, their own actions, and the outcome.` },
  { text: `Walk me through the most challenging example of ${lc(name)} in your work. What made it difficult?`, followUps: "How did you decide on your approach?", guidance: "Specific detail and personal ownership are stronger evidence than general statements." },
];
const lc = (s: string) => s.charAt(0).toLowerCase() + s.slice(1).replace(/\.$/, "");

/**
 * Creates the interview kit for a candidate in a role from the role's APPROVED criteria only.
 * Questions: approved core questions first, then AI-drafted (labeled) or template questions.
 */
export async function createKit(applicationId: string): Promise<Ok> {
  const auth = await requireAuth();
  const app = await ownApplication(auth, applicationId);
  const existing = await db.interviewKit.findUnique({ where: { applicationId } });
  if (existing) return goTo(`/interviews/${existing.id}`);
  const role = await db.role.findFirstOrThrow({
    where: { id: app.roleId, orgId: auth.orgId },
    include: { criteria: { where: { status: "approved" }, orderBy: [{ priority: "asc" }, { position: "asc" }] }, questions: { where: { kind: "core", status: "approved" } } },
  });
  if (!role.criteria.length) return { error: "This role has no approved criteria yet. Approve criteria first — the kit is built only from them." };

  const ai = aiStatus();
  let generated: Awaited<ReturnType<typeof generateInterviewKitWithAi>> | null = null;
  let notice: string | null = null;
  if (ai.configured) {
    try {
      generated = await generateInterviewKitWithAi({ roleTitle: role.title, criteria: role.criteria.map((c) => ({ id: c.id, name: c.name, description: c.description, importance: c.importance })) });
    } catch (err) {
      if (!(err instanceof AiRequestError || err instanceof AiUnavailableError)) logError("interview.kit_ai_failed", err);
      notice = "AI drafting failed, so template questions and anchors were used. Edit them before sharing.";
    }
  } else notice = "AI is off, so template questions and anchors were used. Edit them before sharing.";
  const byCriterion = new Map((generated?.competencies ?? []).map((c) => [c.criterion_id, c]));
  const generator = generated ? `ai:${ai.provider}:${ai.model}/${INTERVIEW_KIT_VERSION}` : `template:${INTERVIEW_KIT_VERSION}`;

  const kit = await db.interviewKit.create({
    data: {
      orgId: auth.orgId,
      applicationId,
      roleId: role.id,
      candidateId: app.candidateId,
      generator,
      criteriaVersion: role.criteriaVersion,
      ownerId: auth.userId,
      ownerName: auth.userName,
    },
  });
  const competencyIds: string[] = [];
  for (const [i, c] of role.criteria.entries()) {
    const g = byCriterion.get(c.id); // ignore anything the model returned for criteria we didn't send
    const core = role.questions.filter((q) => q.criterionId === c.id);
    const qs = [
      ...core.map((q) => ({ text: q.text, followUps: "", guidance: q.rationale, origin: "core_question" })),
      ...(g ? g.questions.slice(0, 3).map((q) => ({ text: q.text.slice(0, 1000), followUps: q.follow_ups.slice(0, 3).join("\n").slice(0, 1000), guidance: q.guidance.slice(0, 1000), origin: "ai" })) : TEMPLATE_QUESTIONS(c.name).map((q) => ({ ...q, origin: "template" }))),
    ];
    const comp = await db.interviewCompetency.create({
      data: {
        kitId: kit.id,
        criterionId: c.id,
        name: c.name,
        description: c.description,
        importance: c.importance,
        position: i,
        anchorsJson: JSON.stringify(g ? { "1": g.anchors.level_1, "2": g.anchors.level_2, "3": g.anchors.level_3, "4": g.anchors.level_4 } : defaultAnchors(c.name)),
        anchorsOrigin: g ? "ai" : "template",
        questions: { create: qs.map((q, j) => ({ kitId: kit.id, text: q.text, followUps: q.followUps, guidance: q.guidance, position: j, origin: q.origin })) },
      },
    });
    competencyIds.push(comp.id);
  }
  await db.interviewStage.create({ data: { kitId: kit.id, name: "Structured interview", purpose: "Gather evidence on the role's approved criteria with the same questions for every candidate.", position: 0, competencyIdsJson: JSON.stringify(competencyIds) } });
  await audit(auth, "interview.kit_created", { subjectType: "application", subjectId: kit.id, candidateId: app.candidateId, roleId: role.id, applicationId, meta: { competencies: competencyIds.length, ai: !!generated } });
  refresh(kit.id, role.id, app.candidateId);
  return goTo(`/interviews/${kit.id}${notice ? `?notice=${encodeURIComponent(notice)}` : ""}`);
}

// ---------------------------------------------------------------- competencies & questions

export async function updateCompetency(id: string, _prev: Ok, fd: FormData): Promise<Ok> {
  const auth = await requireAuth();
  const c = await db.interviewCompetency.findFirst({ where: { id, kit: { orgId: auth.orgId } } });
  if (!c) return { error: "Not found." };
  const name = str(fd, "name", 300);
  if (!name) return { error: "Name can't be empty." };
  const anchors = { "1": str(fd, "a1", 600), "2": str(fd, "a2", 600), "3": str(fd, "a3", 600), "4": str(fd, "a4", 600) };
  if (Object.values(anchors).some((a) => !a)) return { error: "Describe all four rubric levels." };
  const anchorsChanged = JSON.stringify(anchors) !== c.anchorsJson;
  await db.interviewCompetency.update({ where: { id }, data: { name, description: str(fd, "description", 2000), anchorsJson: JSON.stringify(anchors), ...(anchorsChanged ? { anchorsOrigin: "recruiter" } : {}) } });
  await audit(auth, "interview.kit_updated", { subjectType: "application", subjectId: c.kitId, meta: { what: "competency" } });
  refresh(c.kitId);
  return { ok: true, message: "Saved" };
}

/** Adds a competency: one of the role's approved criteria not yet in the kit, or a recruiter-defined one (labeled). */
export async function addCompetency(kitId: string, _prev: Ok, fd: FormData): Promise<Ok> {
  const auth = await requireAuth();
  const kit = await kitOr(auth, kitId);
  if (!kit) return { error: "Not found." };
  const criterionId = str(fd, "criterionId", 60);
  const count = await db.interviewCompetency.count({ where: { kitId } });
  if (criterionId) {
    const c = await db.criterion.findFirst({ where: { id: criterionId, roleId: kit.roleId, orgId: auth.orgId, status: "approved" } });
    if (!c) return { error: "Choose one of the role's approved criteria." };
    await db.interviewCompetency.create({
      data: { kitId, criterionId: c.id, name: c.name, description: c.description, importance: c.importance, position: count, anchorsJson: JSON.stringify(defaultAnchors(c.name)), anchorsOrigin: "template", questions: { create: TEMPLATE_QUESTIONS(c.name).map((q, j) => ({ kitId, ...q, position: j, origin: "template" })) } },
    });
  } else {
    const name = str(fd, "name", 300);
    if (!name) return { error: "Choose a criterion or name the competency." };
    await db.interviewCompetency.create({ data: { kitId, name, description: str(fd, "description", 2000), importance: "preferred", position: count, origin: "recruiter", anchorsJson: JSON.stringify(defaultAnchors(name)), anchorsOrigin: "template" } });
  }
  await audit(auth, "interview.kit_updated", { subjectType: "application", subjectId: kitId, meta: { what: "competency_added" } });
  refresh(kitId);
  return { ok: true, message: "Competency added" };
}

export async function removeCompetency(id: string): Promise<Ok> {
  const auth = await requireAuth();
  const c = await db.interviewCompetency.findFirst({ where: { id, kit: { orgId: auth.orgId } } });
  if (!c) return { error: "Not found." };
  if ((await submittedFor(c.kitId)).competencyIds.has(id)) return { error: "Submitted scorecards include ratings for this competency, so it can't be removed." };
  await db.interviewCompetency.delete({ where: { id } });
  const stages = await db.interviewStage.findMany({ where: { kitId: c.kitId } });
  for (const s of stages) await db.interviewStage.update({ where: { id: s.id }, data: { competencyIdsJson: JSON.stringify((JSON.parse(s.competencyIdsJson) as string[]).filter((x) => x !== id)) } });
  refresh(c.kitId);
  return { ok: true };
}

export async function moveCompetency(id: string, dir: -1 | 1): Promise<Ok> {
  const auth = await requireAuth();
  const c = await db.interviewCompetency.findFirst({ where: { id, kit: { orgId: auth.orgId } } });
  if (!c) return { error: "Not found." };
  const all = await db.interviewCompetency.findMany({ where: { kitId: c.kitId }, orderBy: { position: "asc" } });
  const i = all.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= all.length) return { ok: true };
  [all[i], all[j]] = [all[j], all[i]];
  await db.$transaction(all.map((x, k) => db.interviewCompetency.update({ where: { id: x.id }, data: { position: k } })));
  refresh(c.kitId);
  return { ok: true };
}

export async function addQuestion(competencyId: string, _prev: Ok, fd: FormData): Promise<Ok> {
  const auth = await requireAuth();
  const c = await db.interviewCompetency.findFirst({ where: { id: competencyId, kit: { orgId: auth.orgId } } });
  if (!c) return { error: "Not found." };
  const text = str(fd, "text", 1000);
  if (!text) return { error: "Write the question." };
  const count = await db.interviewQuestion.count({ where: { competencyId } });
  await db.interviewQuestion.create({ data: { competencyId, kitId: c.kitId, text, followUps: str(fd, "followUps", 1000), guidance: str(fd, "guidance", 1000), position: count, origin: "recruiter" } });
  refresh(c.kitId);
  return { ok: true, message: "Question added" };
}

export async function updateQuestion(id: string, _prev: Ok, fd: FormData): Promise<Ok> {
  const auth = await requireAuth();
  const q = await db.interviewQuestion.findFirst({ where: { id, competency: { kit: { orgId: auth.orgId } } } });
  if (!q) return { error: "Not found." };
  const text = str(fd, "text", 1000);
  if (!text) return { error: "The question can't be empty." };
  const followUps = str(fd, "followUps", 1000);
  const guidance = str(fd, "guidance", 1000);
  const changed = text !== q.text || followUps !== q.followUps || guidance !== q.guidance;
  await db.interviewQuestion.update({ where: { id }, data: { text, followUps, guidance, ...(changed ? { edited: true } : {}) } });
  refresh(q.kitId);
  return { ok: true, message: "Saved" };
}

export async function removeQuestion(id: string): Promise<Ok> {
  const auth = await requireAuth();
  const q = await db.interviewQuestion.findFirst({ where: { id, competency: { kit: { orgId: auth.orgId } } } });
  if (!q) return { error: "Not found." };
  await db.interviewQuestion.delete({ where: { id } });
  refresh(q.kitId);
  return { ok: true };
}

export async function moveQuestion(id: string, dir: -1 | 1): Promise<Ok> {
  const auth = await requireAuth();
  const q = await db.interviewQuestion.findFirst({ where: { id, competency: { kit: { orgId: auth.orgId } } } });
  if (!q) return { error: "Not found." };
  const all = await db.interviewQuestion.findMany({ where: { competencyId: q.competencyId }, orderBy: { position: "asc" } });
  const i = all.findIndex((x) => x.id === id);
  const j = i + dir;
  if (j < 0 || j >= all.length) return { ok: true };
  [all[i], all[j]] = [all[j], all[i]];
  await db.$transaction(all.map((x, k) => db.interviewQuestion.update({ where: { id: x.id }, data: { position: k } })));
  refresh(q.kitId);
  return { ok: true };
}

// ---------------------------------------------------------------- stages & interviewers

export async function addStage(kitId: string): Promise<Ok> {
  const auth = await requireAuth();
  const kit = await kitOr(auth, kitId);
  if (!kit) return { error: "Not found." };
  const count = await db.interviewStage.count({ where: { kitId } });
  await db.interviewStage.create({ data: { kitId, name: `Stage ${count + 1}`, position: count, competencyIdsJson: "[]" } });
  refresh(kitId);
  return { ok: true };
}

/** Stage details. Date, time and location are what the recruiter entered — Talyn doesn't schedule meetings. */
export async function updateStage(stageId: string, _prev: Ok, fd: FormData): Promise<Ok> {
  const auth = await requireAuth();
  const st = await db.interviewStage.findFirst({ where: { id: stageId, kit: { orgId: auth.orgId } } });
  if (!st) return { error: "Not found." };
  const name = str(fd, "name", 120);
  if (!name) return { error: "Name the stage." };
  const comps = await db.interviewCompetency.findMany({ where: { kitId: st.kitId }, select: { id: true } });
  const allowed = new Set(comps.map((c) => c.id));
  const ids = fd.getAll("competencyId").map(String).filter((x) => allowed.has(x));
  if (!ids.length) return { error: "Choose at least one competency for this stage." };
  const when = str(fd, "scheduledAt", 40);
  const at = when ? new Date(when) : null;
  if (at && Number.isNaN(at.getTime())) return { error: "Check the date and time." };
  const dur = Number(str(fd, "durationMins", 4)) || null;
  await db.interviewStage.update({
    where: { id: stageId },
    data: { name, purpose: str(fd, "purpose", 500), competencyIdsJson: JSON.stringify(ids), scheduledAt: at, durationMins: dur && dur > 0 && dur <= 480 ? dur : null, locationNote: str(fd, "locationNote", 300) || null },
  });
  await audit(auth, "interview.kit_updated", { subjectType: "application", subjectId: st.kitId, meta: { what: "stage" } });
  refresh(st.kitId);
  return { ok: true, message: "Stage saved" };
}

export async function removeStage(stageId: string): Promise<Ok> {
  const auth = await requireAuth();
  const st = await db.interviewStage.findFirst({ where: { id: stageId, kit: { orgId: auth.orgId } } });
  if (!st) return { error: "Not found." };
  if ((await submittedFor(st.kitId)).stageIds.has(stageId)) return { error: "This stage has submitted scorecards, so it can't be removed." };
  if (await db.interviewEvent.findFirst({ where: { stageId, status: "scheduled" } })) return { error: "This stage has a scheduled interview. Cancel it first so the calendar event is removed too." };
  await db.interviewStage.delete({ where: { id: stageId } });
  refresh(st.kitId);
  return { ok: true };
}

export async function assignInterviewer(stageId: string, userId: string): Promise<Ok> {
  const auth = await requireAuth();
  const st = await db.interviewStage.findFirst({ where: { id: stageId, kit: { orgId: auth.orgId } } });
  if (!st) return { error: "Stage not found." };
  const m = await db.membership.findFirst({ where: { orgId: auth.orgId, userId }, include: { user: { select: { name: true } } } });
  if (!m) return { error: "Interviewers must be members of this workspace. Invite them in Settings → Team." };
  const exists = await db.interviewAssignment.findUnique({ where: { stageId_interviewerId: { stageId, interviewerId: userId } } });
  if (exists) return { ok: true };
  await db.interviewAssignment.create({ data: { kitId: st.kitId, stageId, interviewerId: userId, interviewerName: m.user.name, assignedByName: auth.userName } });
  await audit(auth, "interview.assigned", { subjectType: "application", subjectId: st.kitId, meta: { stageId } });
  refresh(st.kitId);
  return { ok: true };
}

export async function unassignInterviewer(assignmentId: string): Promise<Ok> {
  const auth = await requireAuth();
  const a = await db.interviewAssignment.findFirst({ where: { id: assignmentId, stage: { kit: { orgId: auth.orgId } } } });
  if (!a) return { error: "Not found." };
  if (a.status === "submitted") return { error: "This interviewer already submitted a scorecard, so they can't be removed." };
  await db.interviewAssignment.delete({ where: { id: assignmentId } });
  await audit(auth, "interview.unassigned", { subjectType: "application", subjectId: a.kitId });
  refresh(a.kitId);
  return { ok: true };
}

export async function setHiringManager(kitId: string, userId: string): Promise<Ok> {
  const auth = await requireAuth();
  const kit = await kitOr(auth, kitId);
  if (!kit) return { error: "Not found." };
  if (userId && !(await db.membership.findFirst({ where: { orgId: auth.orgId, userId } }))) return { error: "Choose a workspace member." };
  await db.interviewKit.update({ where: { id: kitId }, data: { hiringManagerId: userId || null } });
  refresh(kitId);
  return { ok: true };
}

/** Makes scorecards available to the assigned interviewers. Talyn doesn't notify them or book meetings. */
export async function shareKit(kitId: string): Promise<Ok> {
  const auth = await requireAuth();
  const kit = await db.interviewKit.findFirst({ where: { id: kitId, orgId: auth.orgId }, include: { stages: { include: { assignments: true } }, application: true } });
  if (!kit) return { error: "Not found." };
  if (!kit.stages.some((s) => (JSON.parse(s.competencyIdsJson) as string[]).length && s.assignments.length)) return { error: "Assign at least one interviewer to a stage with competencies first." };
  await db.interviewKit.update({ where: { id: kitId }, data: { status: "shared", sharedAt: new Date(), sharedByName: auth.userName } });
  await audit(auth, "interview.kit_shared", { subjectType: "application", subjectId: kitId, candidateId: kit.candidateId, roleId: kit.roleId, applicationId: kit.applicationId });
  refresh(kitId, kit.roleId, kit.candidateId);
  return { ok: true, message: "Shared. Interviewers can open their scorecards in Talyn → Interviews. Talyn didn't send them a message." };
}

// ---------------------------------------------------------------- scorecards

/** Saves or submits the signed-in interviewer's own scorecard. Submitted scorecards are locked. */
export async function saveScorecard(assignmentId: string, _prev: Ok, fd: FormData): Promise<Ok> {
  const auth = await requireAuth();
  const a = await db.interviewAssignment.findFirst({ where: { id: assignmentId, stage: { kit: { orgId: auth.orgId } } }, include: { stage: { include: { kit: true } } } });
  if (!a) return { error: "Scorecard not found." };
  if (a.interviewerId !== auth.userId) return { error: "Only the assigned interviewer can fill in this scorecard." };
  if (a.status === "submitted") return { error: "This scorecard was submitted and is locked." };
  if (a.stage.kit.status !== "shared") return { error: "The interview kit hasn't been shared yet." };
  const compIds = JSON.parse(a.stage.competencyIdsJson) as string[];
  const entries: ScoreEntry[] = compIds.map((id) => {
    const r = Number(str(fd, `rating_${id}`, 3));
    const notAssessed = str(fd, `rating_${id}`, 3) === "na";
    return { competencyId: id, rating: (RATING_LEVELS as readonly number[]).includes(r) && !notAssessed ? (r as ScoreEntry["rating"]) : null, notAssessed, evidence: str(fd, `evidence_${id}`, 4000) };
  });
  const qNotes: Record<string, string> = {};
  for (const [k, v] of fd.entries()) if (k.startsWith("qnote_") && typeof v === "string" && v.trim()) qNotes[k.slice(6)] = v.trim().slice(0, 2000);
  const submit = str(fd, "intent", 10) === "submit";
  if (submit) {
    const missing = entries.filter((e) => !e.rating && !e.notAssessed);
    if (missing.length) return { error: `Rate each competency or mark it “Not assessed” (${missing.length} left).` };
    const noEvidence = entries.filter((e) => e.rating && e.evidence.trim().length < 15);
    if (noEvidence.length) return { error: "Add the evidence behind each rating — what the candidate said or did (at least a sentence)." };
  }
  const now = new Date();
  await db.interviewAssignment.update({
    where: { id: assignmentId },
    data: { entriesJson: JSON.stringify(entries), questionNotesJson: JSON.stringify(qNotes), notes: str(fd, "notes", 4000), savedAt: now, status: submit ? "submitted" : "draft", ...(submit ? { submittedAt: now } : {}) },
  });
  await audit(auth, submit ? "interview.scorecard_submitted" : "interview.scorecard_saved", { subjectType: "application", subjectId: a.kitId, candidateId: a.stage.kit.candidateId, roleId: a.stage.kit.roleId, meta: { stage: a.stage.name } });
  refresh(a.kitId, a.stage.kit.roleId, a.stage.kit.candidateId);
  return submit ? { ok: true, redirectTo: `/interviews/${a.kitId}/debrief?submitted=1` } : { ok: true, message: "Draft saved — only you can see it" };
}

/** Plan owner or admin: unlock a submitted scorecard so the interviewer can correct it. Recorded in the audit log. */
export async function reopenScorecard(assignmentId: string): Promise<Ok> {
  const auth = await requireAuth();
  const a = await db.interviewAssignment.findFirst({ where: { id: assignmentId, stage: { kit: { orgId: auth.orgId } } }, include: { stage: { include: { kit: true } } } });
  if (!a) return { error: "Not found." };
  if (!(auth.membershipRole === "admin" || a.stage.kit.ownerId === auth.userId)) return { error: "Only the plan owner or an admin can reopen a scorecard." };
  await db.interviewAssignment.update({ where: { id: assignmentId }, data: { status: "draft", submittedAt: null } });
  await audit(auth, "interview.scorecard_reopened", { subjectType: "application", subjectId: a.kitId, meta: { stage: a.stage.name } });
  refresh(a.kitId);
  return { ok: true, message: `${a.interviewerName}'s scorecard is open for edits again` };
}

// ---------------------------------------------------------------- debrief

export async function addDebriefComment(kitId: string, _prev: Ok, fd: FormData): Promise<Ok> {
  const auth = await requireAuth();
  const v = await loadKitForUser(auth, kitId);
  if (!v) return { error: "Not found." };
  if (!v.canSeeFeedback) return { error: "Submit your own scorecard before joining the debrief." };
  const body = str(fd, "body", 4000);
  if (!body) return { error: "Write a comment." };
  await db.debriefComment.create({ data: { kitId, authorId: auth.userId, authorName: auth.userName, body } });
  await audit(auth, "interview.debrief_comment", { subjectType: "application", subjectId: kitId });
  refresh(kitId);
  return { ok: true, message: "Comment added" };
}

/**
 * The team decision — Advance, Hold or Decline with a rationale — recorded by an authorized person.
 * Talyn never selects it. It doesn't change the pipeline stage or the shortlist decision.
 */
export async function recordInterviewDecision(kitId: string, _prev: Ok, fd: FormData): Promise<Ok> {
  const auth = await requireAuth();
  const v = await loadKitForUser(auth, kitId);
  if (!v) return { error: "Not found." };
  if (!v.canDecide) return { error: "Only an admin, a hiring manager, or this plan's owner can record the team decision." };
  if (!v.canSeeFeedback) return { error: "Submit your own scorecard first." };
  const d = z.enum(DECISIONS).safeParse(str(fd, "decision", 20));
  if (!d.success) return { error: "Choose Advance, Hold or Decline." };
  const rationale = str(fd, "rationale", 4000);
  if (rationale.length < 20) return { error: "Add a rationale grounded in the interview evidence (a sentence or two)." };
  await db.$transaction([
    db.interviewKit.update({ where: { id: kitId }, data: { decision: d.data, decisionRationale: rationale, decidedById: auth.userId, decidedByName: auth.userName, decidedAt: new Date() } }),
    db.debriefComment.create({ data: { kitId, authorId: auth.userId, authorName: auth.userName, body: rationale, kind: `decision:${d.data}` } }),
  ]);
  await audit(auth, "interview.decision", { subjectType: "application", subjectId: kitId, candidateId: v.kit.candidateId, roleId: v.kit.roleId, applicationId: v.kit.applicationId, meta: { decision: d.data } });
  refresh(kitId, v.kit.roleId, v.kit.candidateId);
  return { ok: true, message: "Decision recorded. The pipeline stage is unchanged until you move it." };
}
