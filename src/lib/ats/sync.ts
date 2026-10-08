import "server-only";
import { audit } from "../audit";
import { db } from "../db";
import { STAGES, type Stage } from "../domain";
import { logError, logInfo } from "../log";
import { AtsHttpError, SYNCED_FIELDS, getAtsConnector, type AtsCandidate, type AtsConnector } from "./connector";

const MAX_PAGES = 50;
const MAX_ATTEMPTS = 5;

/** The single workspace linked to the configured ATS, if any. */
export async function linkedOrg() {
  return db.organization.findFirst({ where: { atsLinkedAt: { not: null } }, select: { id: true, name: true, atsLinkedAt: true } });
}

type RunError = { externalId?: string; message: string };
const system = (orgId: string, name: string) => ({ orgId, userId: null, userName: name });

/**
 * Pulls candidates and applications from the ATS into the linked workspace.
 * - Match: ATS id → email → otherwise create (source "ats").
 * - A field is written only when Talyn's value is empty or was last set by the ATS. Any other
 *   difference becomes an AtsConflict for a recruiter to resolve — recruiter edits are never
 *   silently overwritten, and empty ATS values never erase Talyn data.
 * - Applications attach only to roles linked to an ATS job. Mapped ATS stages move the Talyn
 *   stage (a person made that change in the ATS); unmapped stages are left alone.
 */
export async function pullFromAts(orgId: string, triggeredBy: string) {
  const conn = getAtsConnector();
  if (!conn) return null;
  const last = await db.atsSyncRun.findFirst({ where: { orgId, kind: "pull", status: { in: ["completed", "partial"] } }, orderBy: { startedAt: "desc" } });
  const run = await db.atsSyncRun.create({ data: { orgId, connector: conn.key, kind: "pull", status: "running", triggeredBy } });
  const counts = { created: 0, updated: 0, unchanged: 0, conflicts: 0 };
  const errors: RunError[] = [];
  try {
    const roles = await db.role.findMany({ where: { orgId, atsExternalId: { not: null } }, select: { id: true, atsExternalId: true } });
    const roleByJob = new Map(roles.map((r) => [r.atsExternalId!, r.id]));
    const maps = await db.atsStageMap.findMany({ where: { orgId, atsStage: { not: null } } });
    let cursor: string | null | undefined = null;
    for (let page = 0; page < MAX_PAGES; page++) {
      const res: Awaited<ReturnType<AtsConnector["pullCandidates"]>> = await conn.pullCandidates(last?.startedAt ?? null, cursor);
      if (res.skipped) errors.push({ message: `${res.skipped} record(s) on page ${page + 1} were malformed and skipped` });
      for (const ac of res.candidates) {
        try {
          const r = await upsertCandidate(orgId, ac);
          counts[r.result]++;
          counts.conflicts += r.conflicts;
          for (const a of ac.applications ?? []) {
            const roleId = roleByJob.get(a.jobExternalId);
            if (roleId) await upsertApplication(orgId, r.candidateId, roleId, a.externalId, a.stage, maps, conn.label);
          }
        } catch (err) {
          logError("ats.record_failed", err, { externalId: ac.externalId });
          errors.push({ externalId: ac.externalId, message: "Couldn't apply this record" });
        }
      }
      cursor = res.nextCursor;
      if (!cursor) break;
    }
    await db.atsSyncRun.update({ where: { id: run.id }, data: { ...counts, status: errors.length ? "partial" : "completed", errorsJson: JSON.stringify(errors.slice(0, 200)), finishedAt: new Date() } });
  } catch (err) {
    logError("ats.pull_failed", err);
    errors.push({ message: err instanceof AtsHttpError ? `The ATS responded ${err.status}` : "The ATS couldn't be reached or returned an unexpected response" });
    // Nothing already applied is rolled back, and nothing is deleted: the next run resumes from the last successful sync time.
    await db.atsSyncRun.update({ where: { id: run.id }, data: { ...counts, status: "failed", errorsJson: JSON.stringify(errors), finishedAt: new Date() } });
  }
  await audit(system(orgId, triggeredBy), "ats.sync", { subjectType: "org", subjectId: run.id, meta: { kind: "pull", ...counts, errors: errors.length } });
  logInfo("ats.pull", { ...counts, errors: errors.length });
  return { runId: run.id, ...counts, errors: errors.length };
}

async function upsertCandidate(orgId: string, ac: AtsCandidate) {
  let c = await db.candidate.findFirst({ where: { orgId, atsExternalId: ac.externalId } });
  // Email match only for candidates not already linked to another ATS record.
  if (!c && ac.email) c = await db.candidate.findFirst({ where: { orgId, email: ac.email.toLowerCase(), atsExternalId: null } });
  const incoming: Record<string, string | null> = {
    fullName: ac.fullName,
    email: ac.email?.toLowerCase() ?? null,
    phone: ac.phone ?? null,
    location: ac.location ?? null,
    currentTitle: ac.currentTitle ?? null,
    currentCompany: ac.currentCompany ?? null,
    linkedinUrl: ac.linkedinUrl ?? null,
  };
  if (!c) {
    const data = Object.fromEntries(Object.entries(incoming).filter(([, v]) => v)) as Record<string, string>;
    const created = await db.candidate.create({
      data: {
        orgId,
        fullName: ac.fullName,
        ...data,
        source: "ats",
        atsExternalId: ac.externalId,
        atsSyncedAt: new Date(),
        fieldOriginsJson: JSON.stringify(Object.fromEntries(Object.keys(data).map((k) => [k, "ats"]))),
      },
    });
    return { candidateId: created.id, result: "created" as const, conflicts: 0 };
  }
  const origins = JSON.parse(c.fieldOriginsJson || "{}") as Record<string, string>;
  const update: Record<string, string> = {};
  let conflicts = 0;
  for (const f of SYNCED_FIELDS) {
    const atsVal = incoming[f]?.trim();
    if (!atsVal) continue; // an empty ATS value never erases Talyn data
    const talynVal = (c as unknown as Record<string, string | null>)[f]?.trim() ?? "";
    if (atsVal === talynVal) continue;
    if (!talynVal || origins[f] === "ats") {
      update[f] = atsVal;
      origins[f] = "ats";
      continue;
    }
    // Talyn has a value a person entered, corrected or confirmed: record a conflict instead.
    const open = await db.atsConflict.findFirst({ where: { orgId, candidateId: c.id, field: f, status: "open" } });
    if (open) {
      if (open.atsValue !== atsVal) await db.atsConflict.update({ where: { id: open.id }, data: { atsValue: atsVal, talynValue: talynVal } });
    } else {
      const dismissed = await db.atsConflict.findFirst({ where: { orgId, candidateId: c.id, field: f, status: "kept_talyn", atsValue: atsVal, talynValue: talynVal } });
      if (dismissed) continue; // the recruiter already chose Talyn's value for this exact difference
      await db.atsConflict.create({ data: { orgId, candidateId: c.id, externalId: ac.externalId, field: f, talynValue: talynVal, atsValue: atsVal } });
      conflicts++;
    }
  }
  const changed = Object.keys(update).length > 0;
  await db.candidate.update({
    where: { id: c.id },
    data: { ...update, atsExternalId: ac.externalId, atsSyncedAt: new Date(), ...(changed ? { fieldOriginsJson: JSON.stringify(origins) } : {}) },
  });
  return { candidateId: c.id, result: changed ? ("updated" as const) : ("unchanged" as const), conflicts };
}

async function upsertApplication(orgId: string, candidateId: string, roleId: string, externalId: string, atsStage: string, maps: { roleId: string; talynStage: string; atsStage: string | null }[], atsLabel: string) {
  const mapped = maps.find((m) => m.roleId === roleId && m.atsStage?.toLowerCase() === atsStage.toLowerCase())?.talynStage as Stage | undefined;
  let app = await db.application.findFirst({ where: { orgId, candidateId, roleId } });
  if (!app) {
    app = await db.application.create({ data: { orgId, candidateId, roleId, stage: mapped && STAGES.includes(mapped) ? mapped : "new", atsExternalId: externalId } });
    await db.stageEvent.create({ data: { orgId, applicationId: app.id, fromStage: null, toStage: app.stage, actorId: null, actorName: `${atsLabel} (ATS sync)` } });
    return;
  }
  if (app.atsExternalId !== externalId) await db.application.update({ where: { id: app.id }, data: { atsExternalId: externalId } });
  if (!mapped || mapped === app.stage) return;
  // Don't fight a Talyn change that hasn't reached the ATS yet.
  const unsent = await db.atsOutbox.findFirst({ where: { applicationId: app.id, status: { in: ["pending", "failed"] } } });
  if (unsent) return;
  await db.$transaction([
    db.application.update({ where: { id: app.id }, data: { stage: mapped } }),
    db.stageEvent.create({ data: { orgId, applicationId: app.id, fromStage: app.stage, toStage: mapped, actorId: null, actorName: `${atsLabel} (ATS sync)` } }),
  ]);
}

/**
 * Queues a recruiter-made stage change for the ATS. Called only from the recruiter's stage
 * action — never for AI output. Unmapped stages are recorded as "skipped" so the gap is visible.
 */
export async function queueStageChange(actor: { orgId: string; userId: string | null; userName: string }, app: { id: string; roleId: string; atsExternalId: string | null }, toStage: string) {
  const conn = getAtsConnector();
  if (!conn || !conn.canPushStages || !app.atsExternalId) return;
  const org = await db.organization.findUnique({ where: { id: actor.orgId }, select: { atsLinkedAt: true } });
  if (!org?.atsLinkedAt) return;
  const map = await db.atsStageMap.findUnique({ where: { roleId_talynStage: { roleId: app.roleId, talynStage: toStage } } });
  await db.atsOutbox.create({
    data: {
      orgId: actor.orgId,
      applicationId: app.id,
      roleId: app.roleId,
      talynStage: toStage,
      atsStage: map?.atsStage ?? "",
      status: map?.atsStage ? "pending" : "skipped",
      lastError: map?.atsStage ? null : map ? "This stage is set to not sync" : "No ATS stage mapped for this Talyn stage",
      createdByName: actor.userName,
    },
  });
  if (map?.atsStage) await audit(actor, "ats.stage_queued", { subjectType: "application", subjectId: app.id, applicationId: app.id, roleId: app.roleId, meta: { to: toStage } });
}

/** Pushes pending stage changes in order, with exponential backoff. Later changes for an application wait for earlier ones. */
export async function processOutbox(orgId: string) {
  const conn = getAtsConnector();
  if (!conn || !conn.canPushStages) return null;
  const items = await db.atsOutbox.findMany({ where: { orgId, status: "pending", nextAttemptAt: { lte: new Date() } }, orderBy: { createdAt: "asc" }, take: 200 });
  let sent = 0;
  let failed = 0;
  const blocked = new Set<string>();
  for (const it of items) {
    if (blocked.has(it.applicationId)) continue;
    const earlier = await db.atsOutbox.findFirst({ where: { applicationId: it.applicationId, status: { in: ["pending", "failed"] }, createdAt: { lt: it.createdAt } } });
    if (earlier && earlier.id !== it.id) {
      blocked.add(it.applicationId);
      continue;
    }
    const app = await db.application.findUnique({ where: { id: it.applicationId }, select: { atsExternalId: true } });
    if (!app?.atsExternalId) {
      await db.atsOutbox.update({ where: { id: it.id }, data: { status: "skipped", lastError: "Application is no longer linked to the ATS" } });
      continue;
    }
    try {
      await conn.pushStageChange({ externalApplicationId: app.atsExternalId, talynStage: it.talynStage, atsStage: it.atsStage, changedByName: it.createdByName, changedAt: it.createdAt.toISOString() });
      await db.atsOutbox.update({ where: { id: it.id }, data: { status: "sent", sentAt: new Date(), attempts: it.attempts + 1, lastError: null } });
      sent++;
    } catch (err) {
      const attempts = it.attempts + 1;
      const giveUp = attempts >= MAX_ATTEMPTS || (err instanceof AtsHttpError && err.status >= 400 && err.status < 500 && err.status !== 429);
      logError("ats.push_failed", err, { outboxId: it.id });
      await db.atsOutbox.update({
        where: { id: it.id },
        data: {
          attempts,
          status: giveUp ? "failed" : "pending",
          lastError: err instanceof AtsHttpError ? `The ATS responded ${err.status}` : "The ATS couldn't be reached",
          nextAttemptAt: new Date(Date.now() + 2 ** attempts * 60_000),
        },
      });
      blocked.add(it.applicationId);
      failed++;
    }
  }
  if (items.length) {
    await db.atsSyncRun.create({ data: { orgId, connector: conn.key, kind: "push", status: failed ? (sent ? "partial" : "failed") : "completed", updated: sent, errorsJson: JSON.stringify(failed ? [{ message: `${failed} stage change(s) not accepted; will retry or need attention` }] : []), triggeredBy: "outbox", finishedAt: new Date() } });
  }
  return { sent, failed };
}
