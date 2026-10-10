"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, aiStatus, analyzeTranscriptWithAi } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { transcriptAccess } from "@/lib/interviews/transcript-access";
import { logError } from "@/lib/log";
import { fmtTs, parseTranscript, type ParsedSegment } from "@/lib/transcripts/parse";
import { MAX_AUDIO_BYTES, transcribeAudio, transcriptionConfigured } from "@/lib/transcripts/provider";
import { str, type ActionState } from "./form";
import { CONSENT_METHODS } from "@/lib/transcripts/parse";


const paths = (kitId: string, recordingId?: string) => {
  revalidatePath(`/interviews/${kitId}`);
  revalidatePath(`/interviews/${kitId}/transcripts`);
  if (recordingId) revalidatePath(`/interviews/${kitId}/transcripts/${recordingId}`);
};

/** Admin: turn interview recording & transcription on, with the organisation's consent policy. */
export async function setRecordingPolicy(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  if (auth.membershipRole !== "admin") return { error: "Only admins can change this." };
  const enable = fd.get("enable") === "1";
  const policy = str(fd, "recordingPolicy", 2000);
  if (enable && policy.length < 30) return { error: "Describe your recording and consent process (how candidates are told and agree) before turning this on." };
  await db.organization.update({
    where: { id: auth.orgId },
    data: { recordingEnabled: enable, recordingPolicy: policy || undefined, recordingEnabledBy: enable ? auth.userName : null, recordingEnabledAt: enable ? new Date() : null },
  });
  await audit(auth, "recording.policy_changed", { subjectType: "org", subjectId: auth.orgId, meta: { enabled: enable } });
  revalidatePath("/settings");
  return { ok: true, message: enable ? "Recording & transcription turned on." : "Turned off. Existing transcripts are kept until deleted." };
}

async function stageCtx(stageId: string) {
  const auth = await requireAuth();
  const stage = await db.interviewStage.findFirst({ where: { id: stageId, kit: { orgId: auth.orgId } }, select: { id: true, kitId: true, name: true, kit: { select: { applicationId: true, candidateId: true, roleId: true } } } });
  if (!stage) return { error: "Interview stage not found." as const };
  const acc = await transcriptAccess(auth, stage.kitId);
  if (!acc?.canSeeStage(stage.id)) return { error: "You're not on the interview team for this stage." as const };
  const org = await db.organization.findUniqueOrThrow({ where: { id: auth.orgId }, select: { recordingEnabled: true } });
  if (!org.recordingEnabled) return { error: "Recording & transcription is off for this workspace. An admin can turn it on in Workspace settings." as const };
  return { auth, stage };
}

/**
 * Adds a transcript (imported from the meeting tool) or a recording (sent to the transcription
 * provider) for a stage. Requires the interviewer to confirm the organisation's consent process
 * was followed. Talyn never records meetings and keeps no audio.
 */
export async function addTranscript(stageId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const ctx = await stageCtx(stageId);
  if ("error" in ctx) return { error: ctx.error };
  const { auth, stage } = ctx;
  if (fd.get("consentConfirmed") !== "on") return { error: "Confirm the candidate was told and agreed, following your organisation's process." };
  const method = z.enum(CONSENT_METHODS).safeParse(str(fd, "consentMethod"));
  if (!method.success) return { error: "Choose how consent was given." };
  const source = str(fd, "source") === "audio" ? "audio_upload" : "transcript_import";
  const file = fd.get("file");
  let segments: ParsedSegment[] = [];
  let provider = "";
  let fileName = "Pasted transcript";
  let durationMs: number | null = null;
  let error: string | null = null;

  if (source === "audio_upload") {
    if (!transcriptionConfigured()) return { error: "No transcription provider is configured. Import the transcript from your meeting tool instead." };
    if (!(file instanceof File) || !file.size) return { error: "Choose the recording file." };
    if (file.size > MAX_AUDIO_BYTES) return { error: "The recording is over 24 MB. Export a smaller audio file (e.g. MP3 or M4A), or import the meeting tool's transcript." };
    if (!/^(audio|video)\//.test(file.type) && !/\.(mp3|m4a|wav|webm|mp4|mpeg|mpga|ogg)$/i.test(file.name)) return { error: "Upload an audio or video file." };
    fileName = file.name.slice(0, 200);
    try {
      const r = await transcribeAudio(file); // the audio is not stored
      segments = r.segments;
      provider = r.provider;
      durationMs = r.durationMs;
      if (!segments.length) error = "The provider returned no speech.";
    } catch (err) {
      logError("transcript.provider_failed", err, { stageId });
      provider = "openai";
      error = "The transcription provider didn't return a transcript. Nothing was stored; try again or import the meeting tool's transcript.";
    }
  } else {
    let text = str(fd, "text", 400_000);
    if (file instanceof File && file.size) {
      if (file.size > 2 * 1024 * 1024) return { error: "Transcript files must be under 2 MB." };
      text = await file.text();
      fileName = file.name.slice(0, 200);
    }
    const parsed = parseTranscript(text);
    if ("error" in parsed) return { error: parsed.error };
    segments = parsed.segments;
    provider = `import:${parsed.format}`;
    durationMs = segments.length ? segments[segments.length - 1].endMs : null;
  }

  const rec = await db.interviewRecording.create({
    data: {
      orgId: auth.orgId,
      kitId: stage.kitId,
      stageId: stage.id,
      source,
      fileName,
      provider,
      status: error ? "failed" : "transcribed",
      error,
      durationMs,
      consentMethod: method.data,
      consentNote: str(fd, "consentNote", 500) || null,
      consentByName: auth.userName,
      consentById: auth.userId,
      consentAt: new Date(),
      createdByName: auth.userName,
      segments: { create: segments.map((s, i) => ({ idx: i, startMs: s.startMs, endMs: s.endMs, speaker: s.speaker.slice(0, 80), text: s.text, originalText: s.text })) },
    },
  });
  await audit(auth, "recording.added", {
    subjectType: "application",
    subjectId: rec.id,
    candidateId: stage.kit.candidateId,
    roleId: stage.kit.roleId,
    applicationId: stage.kit.applicationId,
    meta: { source, provider, segments: segments.length, consent: method.data, status: rec.status },
  });
  paths(stage.kitId, rec.id);
  return error ? { error } : { ok: true, message: `${segments.length} timestamped passages added. Review speakers and text before relying on them.`, redirectTo: `/interviews/${stage.kitId}/transcripts/${rec.id}` };
}

async function recCtx(recordingId: string) {
  const auth = await requireAuth();
  const rec = await db.interviewRecording.findFirst({ where: { id: recordingId, orgId: auth.orgId } });
  if (!rec) return { error: "Transcript not found." as const };
  const acc = await transcriptAccess(auth, rec.kitId);
  if (!acc?.canSeeStage(rec.stageId)) return { error: "You don't have access to this transcript." as const };
  return { auth, rec, acc };
}

/** Corrects a passage's text or speaker label. The original text is kept. */
export async function editSegment(segmentId: string, text: string, speaker: string): Promise<ActionState> {
  const auth = await requireAuth();
  const seg = await db.transcriptSegment.findFirst({ where: { id: segmentId, recording: { orgId: auth.orgId } } });
  if (!seg) return { error: "Passage not found." };
  const ctx = await recCtx(seg.recordingId);
  if ("error" in ctx) return { error: ctx.error };
  const t = text.trim().slice(0, 4000);
  if (!t) return { error: "A passage can't be empty." };
  await db.transcriptSegment.update({ where: { id: segmentId }, data: { text: t, speaker: speaker.trim().slice(0, 80) || seg.speaker, editedByName: auth.userName, editedAt: new Date() } });
  await audit(auth, "transcript.corrected", { subjectType: "application", subjectId: seg.recordingId, meta: { passage: seg.idx } });
  paths(ctx.rec.kitId, ctx.rec.id);
  return { ok: true, message: "Passage corrected" };
}

/** Says who a speaker label is (interviewer / candidate), and optionally renames it, for every passage with that label. */
export async function setSpeaker(recordingId: string, label: string, role: string, rename: string): Promise<ActionState> {
  const ctx = await recCtx(recordingId);
  if ("error" in ctx) return { error: ctx.error };
  const r = z.enum(["interviewer", "candidate", "unknown"]).safeParse(role);
  if (!r.success) return { error: "Choose interviewer, candidate or unknown." };
  await db.transcriptSegment.updateMany({
    where: { recordingId, speaker: label },
    data: { speakerRole: r.data, ...(rename.trim() ? { speaker: rename.trim().slice(0, 80) } : {}), speakerSetBy: ctx.auth.userName, speakerSetAt: new Date() },
  });
  await audit(ctx.auth, "transcript.speaker_set", { subjectType: "application", subjectId: recordingId, meta: { role: r.data } });
  paths(ctx.rec.kitId, recordingId);
  return { ok: true, message: "Speaker updated" };
}

const squash = (s: string) => s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim();

/**
 * Runs AI analysis on the reviewed transcript: a summary, criterion coverage, quoted evidence and
 * follow-up questions — each tied to passages. Quotes that aren't in the cited passages are dropped.
 * Suggestions that people already reviewed are kept; unreviewed ones are replaced.
 */
export async function analyzeRecording(recordingId: string): Promise<ActionState> {
  const ctx = await recCtx(recordingId);
  if ("error" in ctx) return { error: ctx.error };
  const { auth, rec } = ctx;
  if (rec.status !== "transcribed") return { error: "There's no transcript to analyse." };
  const ai = aiStatus();
  if (!ai.configured) return { error: "AI is off, so there's no summary or evidence suggestions. The transcript is still available to read and correct." };
  const [kit, segs] = await Promise.all([
    db.interviewKit.findFirstOrThrow({ where: { id: rec.kitId }, include: { competencies: true, application: { select: { role: { select: { title: true } } } }, stages: { where: { id: rec.stageId }, select: { competencyIdsJson: true } } } }),
    db.transcriptSegment.findMany({ where: { recordingId }, orderBy: { idx: "asc" } }),
  ]);
  const stageComp = new Set(JSON.parse(kit.stages[0]?.competencyIdsJson ?? "[]") as string[]);
  const comps = kit.competencies.filter((c) => !stageComp.size || stageComp.has(c.id));
  if (!comps.length) return { error: "This stage has no competencies to check the conversation against." };
  try {
    const out = await analyzeTranscriptWithAi({
      roleTitle: kit.application.role.title,
      competencies: comps.map((c) => ({ id: c.id, name: c.name, description: c.description })),
      passages: segs.map((s) => ({ n: s.idx, at: fmtTs(s.startMs), speaker: s.speaker, role: s.speakerRole, text: s.text })),
    });
    const byIdx = new Map(segs.map((s) => [s.idx, s]));
    const compById = new Map(comps.map((c) => [c.id, c]));
    const ids = (ns: number[]) => [...new Set(ns)].map((n) => byIdx.get(n)?.id).filter((x): x is string => !!x);
    const rows: { kind: string; competencyId: string | null; competencyName: string | null; criterionId: string | null; coverage?: string; text: string; quote?: string; segmentIdsJson: string }[] = [];
    const cRef = (id: string) => {
      const c = compById.get(id);
      return c ? { competencyId: c.id, competencyName: c.name, criterionId: c.criterionId } : null;
    };
    for (const s of out.summary) if (ids(s.passages).length) rows.push({ kind: "summary", competencyId: null, competencyName: null, criterionId: null, text: s.text.slice(0, 1000), segmentIdsJson: JSON.stringify(ids(s.passages)) });
    for (const c of out.coverage) {
      const ref = cRef(c.competency_id);
      if (ref) rows.push({ kind: "coverage", ...ref, coverage: c.status, text: c.note.slice(0, 500), segmentIdsJson: JSON.stringify(ids(c.passages)) });
    }
    for (const e of out.evidence) {
      const ref = cRef(e.competency_id);
      const cited = e.passages.map((n) => byIdx.get(n)).filter((x) => !!x);
      // Keep only quotes that really appear in a cited passage.
      if (!ref || !cited.some((s) => squash(s!.text).includes(squash(e.quote)))) continue;
      rows.push({ kind: "evidence", ...ref, text: e.note.slice(0, 800), quote: e.quote.slice(0, 800), segmentIdsJson: JSON.stringify(ids(e.passages)) });
    }
    for (const f of out.follow_ups) {
      const ref = cRef(f.competency_id);
      if (ref) rows.push({ kind: "follow_up", ...ref, text: f.question.slice(0, 500), segmentIdsJson: JSON.stringify(ids(f.passages)) });
    }
    await db.$transaction([
      db.conversationInsight.deleteMany({ where: { recordingId, status: "suggested" } }),
      db.conversationInsight.createMany({ data: rows.map((r) => ({ recordingId, ...r })) }),
      db.interviewRecording.update({ where: { id: recordingId }, data: { analysisModel: `${ai.provider}:${ai.model}`, analyzedAt: new Date() } }),
    ]);
    await audit(auth, "transcript.analyzed", { subjectType: "application", subjectId: recordingId, meta: { suggestions: rows.length } });
    paths(rec.kitId, recordingId);
    return { ok: true, message: `${rows.length} suggestions to review. Each links to the passages behind it.` };
  } catch (err) {
    if (err instanceof AiUnavailableError || err instanceof AiRequestError) return { error: err.message };
    logError("transcript.analysis_failed", err, { recordingId });
    return { error: "The analysis couldn't be completed. The transcript is unchanged." };
  }
}

/** Accept, edit, dismiss or reset an AI suggestion. Recorded with who and when. */
export async function reviewInsight(insightId: string, action: "accept" | "edit" | "dismiss" | "reset", text = ""): Promise<ActionState> {
  const auth = await requireAuth();
  const ins = await db.conversationInsight.findFirst({ where: { id: insightId, recording: { orgId: auth.orgId } } });
  if (!ins) return { error: "Suggestion not found." };
  const ctx = await recCtx(ins.recordingId);
  if ("error" in ctx) return { error: ctx.error };
  if (action === "edit" && !text.trim()) return { error: "Write the corrected text." };
  await db.conversationInsight.update({
    where: { id: insightId },
    data:
      action === "reset"
        ? { status: "suggested", editedText: null, reviewedByName: null, reviewedAt: null }
        : { status: action === "accept" ? "accepted" : action === "edit" ? "edited" : "dismissed", editedText: action === "edit" ? text.trim().slice(0, 1000) : ins.editedText, reviewedByName: auth.userName, reviewedAt: new Date() },
  });
  await audit(auth, "transcript.insight_reviewed", { subjectType: "application", subjectId: ins.recordingId, meta: { kind: ins.kind, action } });
  paths(ctx.rec.kitId, ins.recordingId);
  return { ok: true };
}

/**
 * Copies a reviewed evidence suggestion into the caller's own DRAFT scorecard for that stage, with
 * the transcript timestamp. Never rates, never submits.
 */
export async function addEvidenceToScorecard(insightId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const ins = await db.conversationInsight.findFirst({ where: { id: insightId, recording: { orgId: auth.orgId } }, include: { recording: true } });
  if (!ins || ins.kind !== "evidence" || !ins.competencyId) return { error: "Only evidence suggestions can be added to a scorecard." };
  if (ins.status !== "accepted" && ins.status !== "edited") return { error: "Review the suggestion first — accept or edit it after checking the passage." };
  const assignment = await db.interviewAssignment.findFirst({ where: { stageId: ins.recording.stageId, interviewerId: auth.userId } });
  if (!assignment) return { error: "You aren't an interviewer on this stage, so there's no scorecard of yours to add it to." };
  if (assignment.status === "submitted") return { error: "Your scorecard is already submitted. Ask the plan owner to reopen it if you need to change it." };
  const seg = await db.transcriptSegment.findFirst({ where: { id: (JSON.parse(ins.segmentIdsJson) as string[])[0] ?? "" } });
  const line = `${ins.quote ? `“${ins.quote}”` : ""}${ins.editedText ?? ins.text ? ` — ${ins.editedText ?? ins.text}` : ""}${seg ? ` (transcript ${fmtTs(seg.startMs)})` : ""}`.trim();
  const entries = JSON.parse(assignment.entriesJson) as { competencyId: string; rating: number | null; notAssessed: boolean; evidence: string }[];
  const e = entries.find((x) => x.competencyId === ins.competencyId);
  if (e) e.evidence = [e.evidence?.trim(), line].filter(Boolean).join("\n");
  else entries.push({ competencyId: ins.competencyId, rating: null, notAssessed: false, evidence: line });
  await db.$transaction([
    db.interviewAssignment.update({ where: { id: assignment.id }, data: { entriesJson: JSON.stringify(entries), status: assignment.status === "not_started" ? "draft" : assignment.status, savedAt: new Date() } }),
    db.conversationInsight.update({ where: { id: insightId }, data: { usedInScorecardBy: auth.userName, usedInScorecardAt: new Date() } }),
  ]);
  await audit(auth, "transcript.evidence_to_scorecard", { subjectType: "application", subjectId: ins.recordingId, meta: { competency: ins.competencyName } });
  paths(ins.recording.kitId, ins.recordingId);
  revalidatePath(`/interviews/${ins.recording.kitId}/scorecard/${assignment.id}`);
  return { ok: true, message: "Added to your draft scorecard as evidence. Rate and submit it yourself." };
}

/** Deletes a transcript and everything derived from it. */
export async function deleteRecording(recordingId: string): Promise<ActionState> {
  const ctx = await recCtx(recordingId);
  if ("error" in ctx) return { error: ctx.error };
  if (!ctx.acc.canManage(ctx.rec.consentById)) return { error: "Only an admin, the plan owner or the person who added it can delete it." };
  await db.interviewRecording.delete({ where: { id: recordingId } });
  await audit(ctx.auth, "recording.deleted", { subjectType: "application", subjectId: recordingId, meta: { source: ctx.rec.source } });
  paths(ctx.rec.kitId);
  return { ok: true, message: "Transcript and its suggestions deleted.", redirectTo: `/interviews/${ctx.rec.kitId}/transcripts` };
}
