"use server";

import { randomBytes } from "node:crypto";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, aiStatus } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { analyzeCallWithAi, analyzeIntakeWithAi, benchmarkAnswerWithAi, BEHAVIOURAL_ENGINE_VERSION, CALLS_ENGINE_VERSION, generateBehaviouralBankWithAi, type AnswerCheckResult } from "@/lib/calls/ai";
import { essentialCoverageScore, guessSpeakers, locateQuote, passagesOf, questionAlignmentScore, speakersIn, STAGE_LABEL, stageOf, type Speaker } from "@/lib/calls/core";
import { db } from "@/lib/db";
import { notetakerTokenHash } from "@/lib/calls/token";
import { parseClientProfile } from "@/lib/discovery/target-companies";
import { logError } from "@/lib/log";
import { CONSENT_METHODS, parseTranscript } from "@/lib/transcripts/parse";
import { goTo, optStr, str, type ActionState } from "./form";

const KINDS = ["intake", "screen", "interview"] as const;
const ROLES = ["hiring_manager", "recruiter", "interviewer"] as const;

const aiMessage = (err: unknown, fallback: string) => (err instanceof AiRequestError ? err.message : err instanceof AiUnavailableError ? "AI is off for this workspace." : fallback);

async function recordingOn(orgId: string) {
  const org = await db.organization.findUniqueOrThrow({ where: { id: orgId }, select: { recordingEnabled: true } });
  return org.recordingEnabled;
}

async function ownCall(auth: AuthContext, id: string) {
  return db.roleCall.findFirst({ where: { id, orgId: auth.orgId } });
}

const callPath = (roleId: string | null, id?: string) => {
  if (!roleId) return;
  revalidatePath(`/roles/${roleId}/calls`);
  if (id) revalidatePath(`/roles/${roleId}/calls/${id}`);
};

// ---------- Add a call ----------

/** Saves a call transcript inside a role. The person confirms the candidate or hiring manager knew and agreed. */
export async function addCall(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const role = await db.role.findFirst({ where: { id: roleId, orgId: auth.orgId }, select: { id: true } });
  if (!role) return { error: "Role not found." };
  if (!(await recordingOn(auth.orgId))) return { error: "Recording & transcription is off for this workspace. An admin can turn it on in Workspace settings, with your consent process." };
  if (fd.get("consentConfirmed") !== "on") return { error: "Confirm everyone on the call was told it was transcribed and agreed, following your organisation's process." };
  const method = z.enum(CONSENT_METHODS).safeParse(str(fd, "consentMethod"));
  if (!method.success) return { error: "Choose how consent was given." };
  const kind = z.enum(KINDS).safeParse(str(fd, "kind"));
  if (!kind.success) return { error: "Choose what kind of call this was." };
  const interviewerRole = z.enum(ROLES).safeParse(str(fd, "interviewerRole") || (kind.data === "screen" ? "recruiter" : "hiring_manager"));
  if (!interviewerRole.success) return { error: "Choose who led the call." };
  const interviewerName = optStr(fd, "interviewerName", 120);
  if (!interviewerName) return { error: kind.data === "intake" ? "Name the hiring manager." : "Name the person who asked the questions." };

  let candidateId: string | null = null;
  let applicationId: string | null = null;
  let candidateName: string | null = null;
  if (kind.data !== "intake") {
    const appId = str(fd, "applicationId", 60);
    if (!appId) return { error: "Choose the candidate on this call." };
    const app = await db.application.findFirst({ where: { id: appId, roleId, orgId: auth.orgId }, select: { id: true, candidateId: true, candidate: { select: { fullName: true } } } });
    if (!app) return { error: "That candidate isn't in this role." };
    candidateId = app.candidateId;
    applicationId = app.id;
    candidateName = app.candidate.fullName;
  }

  let text = str(fd, "text", 1_500_000);
  let fileName = "";
  const file = fd.get("file");
  if (file instanceof File && file.size) {
    if (file.size > 2 * 1024 * 1024) return { error: "Transcript files must be under 2 MB." };
    text = await file.text();
    fileName = file.name.slice(0, 200);
  }
  const parsed = parseTranscript(text);
  if ("error" in parsed) return { error: parsed.error };
  const segments = parsed.segments;
  const speakers = guessSpeakers(speakersIn(segments).map((s) => s.label), { candidate: candidateName, interviewer: interviewerName });
  const occurred = str(fd, "occurredAt", 30);

  const call = await db.roleCall.create({
    data: {
      orgId: auth.orgId,
      roleId,
      kind: kind.data,
      title: str(fd, "title", 200) || fileName || (kind.data === "intake" ? `Intake with ${interviewerName}` : `${candidateName} with ${interviewerName}`),
      occurredAt: occurred && !Number.isNaN(Date.parse(occurred)) ? new Date(occurred) : null,
      durationMs: segments.at(-1)?.endMs ?? null,
      source: fileName ? "upload" : "paste",
      provider: `import:${parsed.format}`,
      candidateId,
      applicationId,
      interviewerName,
      interviewerRole: interviewerRole.data,
      speakersJson: JSON.stringify(speakers),
      consentMethod: method.data,
      consentByName: auth.userName,
      consentAt: new Date(),
      status: "ready",
      createdByName: auth.userName,
      segments: { create: segments.map((s, i) => ({ idx: i, startMs: s.startMs, endMs: s.endMs, speaker: (s.speaker || "Unlabelled").slice(0, 120), text: s.text })) },
    },
  });
  await audit(auth, "call.added", { subjectType: "call", subjectId: call.id, roleId, candidateId, applicationId, meta: { kind: kind.data, passages: segments.length, consent: method.data } });
  return goTo(`/roles/${roleId}/calls/${call.id}`);
}

// ---------- Set up a call ----------

export async function setCallSpeakers(callId: string, speakers: Speaker[]): Promise<ActionState> {
  const auth = await requireAuth();
  const call = await ownCall(auth, callId);
  if (!call) return { error: "Call not found." };
  const known = new Set((JSON.parse(call.speakersJson) as Speaker[]).map((s) => s.label));
  const clean = speakers.filter((s) => known.has(s.label)).map((s) => ({ label: s.label, role: (["candidate", "interviewer", "other"] as const).includes(s.role) ? s.role : "other" }));
  await db.roleCall.update({ where: { id: call.id }, data: { speakersJson: JSON.stringify(clean) } });
  callPath(call.roleId, call.id);
  return { ok: true, message: "Speakers saved. Run the check again to use them." };
}

/** Assigns a call (e.g. one a notetaker sent) to a role, with its kind, candidate and interviewer. */
export async function updateCallDetails(callId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const call = await ownCall(auth, callId);
  if (!call) return { error: "Call not found." };
  const roleId = str(fd, "roleId", 60) || call.roleId;
  if (!roleId) return { error: "Choose the role this call belongs to." };
  const role = await db.role.findFirst({ where: { id: roleId, orgId: auth.orgId }, select: { id: true } });
  if (!role) return { error: "Role not found." };
  const kind = z.enum(KINDS).safeParse(str(fd, "kind") || call.kind);
  const ir = z.enum(ROLES).safeParse(str(fd, "interviewerRole") || call.interviewerRole);
  if (!kind.success || !ir.success) return { error: "Choose the kind of call and who led it." };
  let candidateId: string | null = null;
  let applicationId: string | null = null;
  let candidateName: string | null = null;
  if (kind.data !== "intake") {
    const app = await db.application.findFirst({ where: { id: str(fd, "applicationId", 60), roleId, orgId: auth.orgId }, select: { id: true, candidateId: true, candidate: { select: { fullName: true } } } });
    if (!app) return { error: "Choose the candidate on this call (they must be in the role)." };
    candidateId = app.candidateId;
    applicationId = app.id;
    candidateName = app.candidate.fullName;
  }
  const interviewerName = optStr(fd, "interviewerName", 120) ?? call.interviewerName;
  // Speakers nobody has set yet get a fresh guess from the confirmed names; choices already made stay.
  const current = JSON.parse(call.speakersJson) as Speaker[];
  const guessed = new Map(guessSpeakers(current.map((x) => x.label), { candidate: candidateName, interviewer: interviewerName }).map((x) => [x.label, x.role]));
  const speakers = current.map((x) => (x.role === "other" ? { ...x, role: guessed.get(x.label) ?? "other" } : x));
  const moved = roleId !== call.roleId;
  await db.$transaction([
    db.roleCall.update({
      where: { id: call.id },
      data: { roleId, kind: kind.data, interviewerRole: ir.data, interviewerName, speakersJson: JSON.stringify(speakers), candidateId, applicationId, title: str(fd, "title", 200) || call.title, status: call.status === "needs_role" ? "ready" : call.status },
    }),
    // A check made for another role or setup no longer applies.
    ...(moved || kind.data !== call.kind ? [db.callAnalysis.deleteMany({ where: { callId: call.id } })] : []),
  ]);
  await audit(auth, "call.updated", { subjectType: "call", subjectId: call.id, roleId, candidateId, applicationId, meta: { kind: kind.data, assigned: call.status === "needs_role" } });
  if (call.roleId && moved) callPath(call.roleId);
  revalidatePath("/inbox");
  return goTo(`/roles/${roleId}/calls/${call.id}`);
}

export async function deleteCall(callId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const call = await ownCall(auth, callId);
  if (!call) return { error: "Call not found." };
  await db.roleCall.delete({ where: { id: call.id } });
  await audit(auth, "call.deleted", { subjectType: "call", subjectId: call.id, roleId: call.roleId, candidateId: call.candidateId, meta: { kind: call.kind } });
  revalidatePath("/inbox");
  return goTo(call.roleId ? `/roles/${call.roleId}/calls` : "/inbox");
}

// ---------- Check a call against the JD ----------

async function roleContext(orgId: string, roleId: string) {
  const role = await db.role.findFirstOrThrow({
    where: { id: roleId, orgId },
    select: {
      id: true,
      title: true,
      description: true,
      criteriaVersion: true,
      criteria: { where: { status: "approved", importance: { not: "informational" } }, orderBy: [{ position: "asc" }, { createdAt: "asc" }], select: { id: true, name: true, description: true, importance: true } },
      documents: { where: { isCurrent: true }, orderBy: { createdAt: "desc" }, take: 1, select: { pagesJson: true } },
      behavioural: true,
    },
  });
  const jd = role.documents[0] ? (JSON.parse(role.documents[0].pagesJson) as string[]).join("\n\n") : role.description;
  const criteria = role.criteria.map((c) => ({ id: c.id, name: c.name, description: c.description, essential: c.importance === "essential" }));
  const bank = role.behavioural ? (JSON.parse(role.behavioural.questionsJson) as BankQuestion[]) : [];
  return { role, jd, criteria, bank };
}

export type BankQuestion = {
  id: string;
  theme: string;
  scenario_id: string;
  question: string;
  why: string;
  probes: { level: number; question: string; listen_for: string }[];
  strong_signals: string[];
  weak_signals: string[];
  red_flags: string[];
  benchmark: string;
};

/** Runs the alignment check. Suggestions only: nothing here moves, decides on or contacts anyone. */
export async function analyzeCall(callId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const call = await db.roleCall.findFirst({ where: { id: callId, orgId: auth.orgId }, include: { segments: { orderBy: { idx: "asc" } } } });
  if (!call || !call.roleId) return { error: "Assign this call to a role first." };
  const ai = aiStatus();
  if (!ai.configured) return { error: "AI is off for this workspace, so calls can't be checked yet." };
  const { role, jd, criteria, bank } = await roleContext(auth.orgId, call.roleId);
  if (!criteria.length) return { error: "Approve this role's criteria first; the check compares the call against them." };
  const speakers = JSON.parse(call.speakersJson) as Speaker[];
  if (call.kind !== "intake" && !speakers.some((s) => s.role === "candidate")) return { error: "Mark which speaker is the candidate first, so their words and the interviewer's questions aren't mixed up." };
  const passages = passagesOf(call.segments, speakers);
  if (!passages.length) return { error: "This call has no transcript text." };

  const ids = new Set(criteria.map((c) => c.id));
  const name = new Map(criteria.map((c) => [c.id, c.name]));
  const essential = new Map(criteria.map((c) => [c.id, c.essential]));
  const roleOf = new Map(passages.map((p) => [p.n, p.role]));
  const model = `ai:${ai.provider}:${ai.model}`;

  try {
    if (call.kind === "intake") {
      const r = await analyzeIntakeWithAi({ roleTitle: role.title, jd, criteria, passages });
      const expectations = r.expectations
        .map((e) => ({ ...e, criterion_id: ids.has(e.criterion_id) ? e.criterion_id : "", passage: locateQuote(e.said, passages, e.passage) }))
        .filter((e) => e.passage !== null);
      const coverage = criteria.map((c) => {
        const hit = r.coverage.find((x) => x.criterion_id === c.id);
        return { criterion_id: c.id, name: c.name, essential: c.essential, asked: !!hit?.asked, passages: (hit?.passages ?? []).filter((n) => roleOf.has(n)) };
      });
      await saveAnalysis(auth, call.id, role.id, model, role.criteriaVersion, { expectations, coverage, suggestions: r.suggestions.slice(0, 5), questionAlignment: null, essentialCoverage: essentialCoverageScore(coverage) });
    } else {
      const r = await analyzeCallWithAi({ roleTitle: role.title, jd, criteria, behavioural: bank, passages });
      const candidate = criteria.map((c) => {
        const it = r.candidate.find((x) => x.criterion_id === c.id);
        const n = it?.quote ? locateQuote(it.quote, passages, it.passage) : null;
        // A quote must be the candidate's own words; otherwise it's shown without one.
        const own = n !== null && roleOf.get(n) === "candidate";
        return { criterion_id: c.id, name: c.name, essential: c.essential, status: it?.status ?? "not_discussed", note: it?.note ?? "Not covered by the check.", quote: own ? it!.quote : "", passage: own ? n : null };
      });
      const questions = r.questions
        .map((q) => ({ ...q, criterion_id: ids.has(q.criterion_id) ? q.criterion_id : "", criterion: name.get(q.criterion_id) ?? null, passage: locateQuote(q.question, passages, q.passage) }))
        .filter((q) => q.passage !== null && roleOf.get(q.passage) !== "candidate");
      const coverage = criteria.map((c) => {
        const asked = questions.some((q) => q.criterion_id === c.id && q.alignment !== "risky") || !!r.coverage.find((x) => x.criterion_id === c.id)?.asked;
        return { criterion_id: c.id, name: c.name, essential: c.essential, asked, passages: questions.filter((q) => q.criterion_id === c.id).map((q) => q.passage!) };
      });
      const bankIds = new Set(bank.map((b) => b.id));
      const behavioural = r.behavioural
        .filter((b) => bankIds.has(b.question_id))
        .map((b) => {
          const n = b.asked && b.answer_quote ? locateQuote(b.answer_quote, passages, b.passage) : null;
          return { ...b, passage: n, answer_quote: n !== null ? b.answer_quote : "" };
        });
      await saveAnalysis(auth, call.id, role.id, model, role.criteriaVersion, {
        candidate,
        questions,
        coverage,
        behavioural,
        suggestions: r.suggestions.slice(0, 5),
        questionAlignment: questionAlignmentScore(questions),
        essentialCoverage: essentialCoverageScore(coverage.map((c) => ({ essential: essential.get(c.criterion_id) ?? false, asked: c.asked }))),
      });
    }
  } catch (err) {
    if (!(err instanceof AiRequestError || err instanceof AiUnavailableError)) logError("call.analyze_failed", err, { callId });
    await db.roleCall.update({ where: { id: call.id }, data: { status: "failed", error: "The check didn't finish." } });
    callPath(call.roleId, call.id);
    return { error: `${aiMessage(err, "The check didn't finish.")} Nothing was changed; try again.` };
  }
  await audit(auth, "call.analyzed", { subjectType: "call", subjectId: call.id, roleId: call.roleId, candidateId: call.candidateId, applicationId: call.applicationId, meta: { kind: call.kind, model } });
  callPath(call.roleId, call.id);
  revalidatePath("/companies", "layout");
  return { ok: true, message: "Checked against the JD. These are suggestions to review, not decisions." };
}

async function saveAnalysis(
  auth: AuthContext,
  callId: string,
  roleId: string,
  model: string,
  criteriaVersion: number,
  a: { candidate?: unknown[]; questions?: unknown[]; coverage: unknown[]; expectations?: unknown[]; behavioural?: unknown[]; suggestions: unknown[]; questionAlignment: number | null; essentialCoverage: number | null },
) {
  const data = {
    orgId: auth.orgId,
    roleId,
    model,
    version: CALLS_ENGINE_VERSION,
    criteriaVersion,
    candidateJson: JSON.stringify(a.candidate ?? []),
    questionsJson: JSON.stringify(a.questions ?? []),
    coverageJson: JSON.stringify(a.coverage),
    expectationsJson: JSON.stringify(a.expectations ?? []),
    behaviouralJson: JSON.stringify(a.behavioural ?? []),
    suggestionsJson: JSON.stringify(a.suggestions),
    questionAlignment: a.questionAlignment,
    essentialCoverage: a.essentialCoverage,
    createdByName: auth.userName,
    createdAt: new Date(),
  };
  await db.$transaction([
    db.callAnalysis.upsert({ where: { callId }, create: { callId, ...data }, update: data }),
    db.roleCall.update({ where: { id: callId }, data: { status: "analyzed", error: null } }),
  ]);
}

// ---------- Behavioural question bank ----------

export async function generateBehavioural(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const ai = aiStatus();
  if (!ai.configured) return { error: "AI is off for this workspace." };
  const { role, jd, criteria } = await roleContext(auth.orgId, roleId);
  const full = await db.role.findFirstOrThrow({ where: { id: roleId, orgId: auth.orgId }, select: { clientCompanyName: true, targetCompanies: { select: { clientProfileJson: true } } } });
  const fromProfile = full.targetCompanies ? parseClientProfile(full.targetCompanies.clientProfileJson)?.headcount_band : null;
  const headcount = str(fd, "headcount", 30) || fromProfile || "not known";
  const stage = stageOf(headcount);
  try {
    const r = await generateBehaviouralBankWithAi({ roleTitle: role.title, jd, companyName: full.clientCompanyName, stage: STAGE_LABEL[stage], headcount, criteria: criteria.map((c) => c.name) });
    const scen = new Map(r.scenarios.map((s, i) => [s.id, `s${i + 1}`]));
    const scenarios = r.scenarios.map((s, i) => ({ ...s, id: `s${i + 1}` }));
    const questions: BankQuestion[] = r.questions.slice(0, 12).map((q, i) => ({ ...q, id: `b${i + 1}`, scenario_id: scen.get(q.scenario_id) ?? "", probes: [...q.probes].sort((a, b) => a.level - b.level).slice(0, 4) }));
    const data = { orgId: auth.orgId, companySize: headcount, scenariosJson: JSON.stringify(scenarios), questionsJson: JSON.stringify(questions), model: `ai:${ai.provider}:${ai.model}/${BEHAVIOURAL_ENGINE_VERSION}`, generatedByName: auth.userName, generatedAt: new Date() };
    await db.behaviouralSet.upsert({ where: { roleId }, create: { roleId, ...data }, update: data });
  } catch (err) {
    if (!(err instanceof AiRequestError || err instanceof AiUnavailableError)) logError("behavioural.generate_failed", err, { roleId });
    return { error: `${aiMessage(err, "The questions couldn't be written.")} Try again.` };
  }
  await audit(auth, "behavioural.generated", { subjectType: "role", subjectId: roleId, roleId, meta: { headcount } });
  revalidatePath(`/roles/${roleId}/calls`);
  return { ok: true, message: "Behavioural questions ready. Edit or drop any that don't fit before using them." };
}

/** Compares a recruiter's notes of one answer with the question's benchmark. Nothing is stored. */
export async function checkAnswer(roleId: string, questionId: string, answer: string): Promise<{ result: AnswerCheckResult } | { error: string }> {
  const auth = await requireAuth();
  if (answer.trim().length < 20) return { error: "Write down a bit more of what they said (at least a sentence or two)." };
  const set = await db.behaviouralSet.findFirst({ where: { roleId, orgId: auth.orgId } });
  const q = set ? (JSON.parse(set.questionsJson) as BankQuestion[]).find((x) => x.id === questionId) : null;
  if (!set || !q) return { error: "Question not found. Generate the question bank again." };
  try {
    const result = await benchmarkAnswerWithAi({ question: q, answer, stage: STAGE_LABEL[stageOf(set.companySize)] });
    return { result };
  } catch (err) {
    if (!(err instanceof AiRequestError || err instanceof AiUnavailableError)) logError("behavioural.check_failed", err, { roleId });
    return { error: aiMessage(err, "The check didn't finish. Try again.") };
  }
}

// ---------- Notetaker connection ----------


/** Admin: create (or replace) the workspace's notetaker webhook token. The token is shown once. */
export async function createNotetakerToken(name: string): Promise<{ token: string } | { error: string }> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can connect a notetaker." };
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { recordingEnabled: true } });
  if (!org.recordingEnabled) return { error: "Turn on recording & transcription in Workspace settings first, with your consent process." };
  const token = `tnt_${randomBytes(24).toString("base64url")}`;
  await db.organization.update({ where: { id: auth.orgId }, data: { notetakerTokenHash: notetakerTokenHash(token), notetakerName: name.trim().slice(0, 60) || "Notetaker", notetakerTokenAt: new Date(), notetakerTokenBy: auth.userName } });
  await audit(auth, "notetaker.token_created", { subjectType: "org", subjectId: auth.orgId });
  revalidatePath("/integrations");
  return { token };
}

export async function revokeNotetakerToken(): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can disconnect the notetaker." };
  await db.organization.update({ where: { id: auth.orgId }, data: { notetakerTokenHash: null, notetakerTokenAt: null, notetakerTokenBy: null } });
  await audit(auth, "notetaker.token_revoked", { subjectType: "org", subjectId: auth.orgId });
  revalidatePath("/integrations");
  return { ok: true, message: "Disconnected. Calls already received are kept." };
}

