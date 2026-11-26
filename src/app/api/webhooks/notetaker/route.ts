import { guessSpeakers, NotetakerPayload, segmentsFromPayload, speakersIn } from "@/lib/calls/core";
import { notetakerTokenHash } from "@/lib/calls/token";
import { db } from "@/lib/db";
import { logError, logInfo } from "@/lib/log";
import { parseTranscript } from "@/lib/transcripts/parse";

/**
 * Calls from a meeting notetaker (Fireflies, Otter, Fathom, tl;dv, Read.ai… directly or through
 * Zapier/Make). Contract in docs/INTEGRATIONS.md:
 *   Authorization: Bearer <the workspace's notetaker token>
 *   { external_id, title, started_at?, participants[], role_id?, candidate_email?, segments[] | transcript }
 * Every call lands as "needs setup": a person confirms the role, the candidate and who asked the
 * questions before anything is checked. Repeats of the same external_id are ignored.
 */
export async function POST(req: Request) {
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7).trim() : "";
  if (!token) return new Response("Unauthorized", { status: 401 });
  const org = await db.organization.findUnique({ where: { notetakerTokenHash: notetakerTokenHash(token) }, select: { id: true, recordingEnabled: true, notetakerName: true } });
  if (!org) return new Response("Unauthorized", { status: 401 });
  if (!org.recordingEnabled) return Response.json({ ok: false, error: "Recording & transcription is off for this workspace" }, { status: 403 });

  const parsed = NotetakerPayload.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "Invalid payload", issues: parsed.error.issues.slice(0, 5).map((i) => `${i.path.join(".")}: ${i.message}`) }, { status: 400 });
  const p = parsed.data;

  const dup = await db.roleCall.findFirst({ where: { orgId: org.id, externalId: p.external_id }, select: { id: true } });
  if (dup) return Response.json({ ok: true, id: dup.id, duplicate: true });

  let segments = segmentsFromPayload(p);
  let format = "segments";
  if (!segments) {
    const t = parseTranscript(p.transcript ?? "");
    if ("error" in t) return Response.json({ ok: false, error: t.error }, { status: 400 });
    segments = t.segments;
    format = t.format;
  }
  if (!segments.length) return Response.json({ ok: false, error: "The transcript has no text" }, { status: 400 });

  // Suggestions for the person who sets the call up; nothing is decided from them.
  const role = p.role_id ? await db.role.findFirst({ where: { id: p.role_id, orgId: org.id }, select: { id: true } }) : null;
  const email = p.candidate_email?.trim().toLowerCase();
  const candidate = email ? await db.candidate.findFirst({ where: { orgId: org.id, email: { equals: email, mode: "insensitive" } }, select: { id: true, fullName: true } }) : null;
  const apps = candidate ? await db.application.findMany({ where: { orgId: org.id, candidateId: candidate.id, stage: { notIn: ["hired", "rejected"] }, ...(role ? { roleId: role.id } : {}) }, select: { id: true, roleId: true }, take: 2 }) : [];
  const app = apps.length === 1 ? apps[0] : null;
  const name = (org.notetakerName || p.notetaker || "Notetaker").slice(0, 60);

  try {
    const call = await db.roleCall.create({
      data: {
        orgId: org.id,
        roleId: role?.id ?? app?.roleId ?? null,
        kind: candidate ? "interview" : "intake",
        title: p.title.slice(0, 200) || "Call",
        occurredAt: p.started_at ? new Date(p.started_at) : null,
        durationMs: p.duration_seconds ? Math.round(p.duration_seconds * 1000) : (segments.at(-1)?.endMs ?? null),
        source: "notetaker",
        provider: `notetaker:${name}:${format}`,
        externalId: p.external_id,
        candidateId: candidate?.id ?? null,
        applicationId: app?.id ?? null,
        participantsJson: JSON.stringify(p.participants),
        speakersJson: JSON.stringify(guessSpeakers(speakersIn(segments).map((s) => s.label), { candidate: candidate?.fullName })),
        consentMethod: "policy_notice",
        consentByName: `${name} (notetaker)`,
        consentAt: new Date(),
        status: "needs_role",
        createdByName: name,
        segments: { create: segments.map((s, i) => ({ idx: i, startMs: s.startMs, endMs: s.endMs, speaker: (s.speaker || "Unlabelled").slice(0, 120), text: s.text })) },
      },
      select: { id: true },
    });
    await db.auditEvent.create({ data: { orgId: org.id, actorName: name, action: "call.received", subjectType: "call", subjectId: call.id, roleId: role?.id ?? app?.roleId ?? null, candidateId: candidate?.id ?? null, metaJson: JSON.stringify({ passages: segments.length, format }) } });
    logInfo("notetaker.call_received", { orgId: org.id, callId: call.id, passages: segments.length });
    return Response.json({ ok: true, id: call.id, status: "needs_setup" }, { status: 201 });
  } catch (err) {
    logError("notetaker.store_failed", err, { orgId: org.id });
    return Response.json({ ok: false, error: "Couldn't store the call" }, { status: 500 });
  }
}
