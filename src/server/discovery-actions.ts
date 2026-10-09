"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { BRIEF_FIELD_LABEL, WORK_ARRANGEMENTS, booleanKey, buildBoolean, checkBoolean, splitList, type BriefFields, type Prov, type Provenance, type WorkArrangement } from "@/lib/discovery/brief";
import { suggestBriefFromJd } from "@/lib/discovery/extract";
import { briefColumns, briefFields, briefProvenance } from "@/lib/discovery/store";
import { logError } from "@/lib/log";
import { SourceError, connector, type RawProfile } from "@/lib/sourcing/connectors";
import { EMPTY_FILTERS, type SearchFilters } from "@/lib/sourcing/filters";
import { mergeAcrossSources } from "@/lib/sourcing/merge";
import { goTo, str, type ActionState } from "./form";
import { ownRole } from "./scope";

const refresh = (roleId: string) => {
  revalidatePath(`/roles/${roleId}/discover`);
  revalidatePath("/discover");
};

function readFields(fd: FormData): { fields?: BriefFields; error?: string } {
  const num = (k: string) => {
    const v = str(fd, k, 4);
    if (!v) return null;
    const n = Number(v);
    return Number.isInteger(n) && n >= 0 && n <= 50 ? n : NaN;
  };
  const minYears = num("minYears");
  const maxYears = num("maxYears");
  if (Number.isNaN(minYears) || Number.isNaN(maxYears)) return { error: "Years of experience must be whole numbers from 0 to 50." };
  if (minYears != null && maxYears != null && minYears > maxYears) return { error: "Minimum years can't be more than maximum years." };
  const wa = str(fd, "workArrangement", 20);
  const roleName = str(fd, "roleName", 200);
  if (!roleName) return { error: "Add a role name." };
  return {
    fields: {
      roleName,
      altTitles: splitList(str(fd, "altTitles", 2000)).map((s) => s.slice(0, 80)).slice(0, 8),
      skillsRequired: splitList(str(fd, "skillsRequired", 3000)).map((s) => s.slice(0, 80)),
      skillsPreferred: splitList(str(fd, "skillsPreferred", 3000)).map((s) => s.slice(0, 80)),
      exclusions: splitList(str(fd, "exclusions", 1000)).map((s) => s.slice(0, 80)).slice(0, 10),
      minYears,
      maxYears,
      location: str(fd, "location", 200) || null,
      workArrangement: (WORK_ARRANGEMENTS as readonly string[]).includes(wa) ? (wa as WorkArrangement) : null,
    },
  };
}

/** Field provenance after a recruiter edit: unchanged values keep their JD source; changed ones become "edited". */
function mergeProvenance(prev: Provenance, before: BriefFields, after: BriefFields, manual: boolean): Provenance {
  const out: Provenance = {};
  for (const k of Object.keys(BRIEF_FIELD_LABEL) as (keyof BriefFields)[]) {
    const p = prev[k];
    const same = JSON.stringify(before[k]) === JSON.stringify(after[k]);
    const empty = after[k] == null || after[k] === "" || (Array.isArray(after[k]) && (after[k] as string[]).length === 0);
    if (same && p) out[k] = p;
    else if (empty) out[k] = p?.status === "not_stated" && same ? p : { status: manual ? "manual" : "edited" };
    else if (Array.isArray(after[k]) && p?.items) {
      // Keep quotes for list items that survived the edit.
      const items: NonNullable<Prov["items"]> = {};
      for (const v of after[k] as string[]) if (p.items[v]) items[v] = p.items[v];
      out[k] = { status: manual ? "manual" : "edited", items };
    } else out[k] = { status: manual ? "manual" : "edited" };
  }
  return out;
}

/** Manual setup: creates the role and its discovery fields from what the recruiter typed. */
export async function startManualDiscovery(_prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const r = readFields(fd);
  if (!r.fields) return { error: r.error };
  const f = r.fields;
  const role = await db.role.create({
    data: { orgId: auth.orgId, title: f.roleName, location: f.location ?? "", status: "draft", createdById: auth.userId },
  });
  const prov: Provenance = Object.fromEntries((Object.keys(BRIEF_FIELD_LABEL) as (keyof BriefFields)[]).map((k) => [k, { status: "manual" }]));
  await db.discoveryBrief.create({
    data: {
      orgId: auth.orgId,
      roleId: role.id,
      origin: "manual",
      ...briefColumns(f),
      provenanceJson: JSON.stringify(prov),
      booleanQuery: buildBoolean(f),
      booleanFieldsKey: booleanKey(f),
      confirmedAt: new Date(),
      confirmedByName: auth.userName,
      updatedByName: auth.userName,
    },
  });
  await audit(auth, "discover.setup", { subjectType: "role", subjectId: role.id, roleId: role.id, meta: { origin: "manual" } });
  return goTo(`/roles/${role.id}/discover`);
}

/**
 * Upload flow stage: suggests discovery fields from the role's current JD. Fields the recruiter
 * already edited are kept; everything else is replaced by the new suggestion. Not confirmed until saved.
 */
export async function suggestBriefStep(roleId: string): Promise<{ ok?: boolean; error?: string; notice?: string | null }> {
  const auth = await requireAuth();
  const role = await ownRole(auth, roleId);
  const jd = await db.jobDescription.findFirst({ where: { roleId, orgId: auth.orgId, isCurrent: true } });
  if (!jd) return { error: "No uploaded job description found for this role." };
  const titleFact = await db.extractedField.findFirst({ where: { roleId, orgId: auth.orgId, field: "title", status: { not: "rejected" } }, orderBy: { createdAt: "desc" } });
  const fallbackTitle = titleFact ? (JSON.parse(titleFact.editedValueJson ?? titleFact.valueJson) as string) : role.title.startsWith("Untitled role") ? null : role.title;
  try {
    const s = await suggestBriefFromJd(JSON.parse(jd.pagesJson) as string[], fallbackTitle);
    const existing = await db.discoveryBrief.findUnique({ where: { roleId } });
    let fields = s.fields;
    let prov = s.provenance;
    if (existing) {
      const prevF = briefFields(existing);
      const prevP = briefProvenance(existing);
      fields = { ...s.fields };
      prov = { ...s.provenance };
      for (const k of Object.keys(BRIEF_FIELD_LABEL) as (keyof BriefFields)[]) {
        if (prevP[k]?.status === "edited" || prevP[k]?.status === "manual") {
          (fields as Record<string, unknown>)[k] = prevF[k];
          prov[k] = prevP[k];
        }
      }
    }
    const data = {
      origin: "jd",
      ...briefColumns(fields),
      provenanceJson: JSON.stringify(prov),
      booleanQuery: buildBoolean(fields),
      booleanEdited: false,
      booleanFieldsKey: booleanKey(fields),
      extractor: s.extractor,
      jdId: jd.id,
      confirmedAt: null,
      confirmedByName: null,
      updatedByName: auth.userName,
    };
    await db.discoveryBrief.upsert({ where: { roleId }, create: { orgId: auth.orgId, roleId, ...data }, update: data });
    await audit(auth, "discover.setup", { subjectType: "role", subjectId: roleId, roleId, meta: { origin: "jd", method: s.extractor.split(":")[0] } });
    refresh(roleId);
    return { ok: true, notice: s.notice };
  } catch (err) {
    logError("discover.suggest_failed", err, { roleId });
    return { error: "Search fields couldn't be suggested. The JD is saved — fill in the fields yourself." };
  }
}

async function saveFields(auth: AuthContext, roleId: string, fd: FormData) {
  const role = await ownRole(auth, roleId);
  const r = readFields(fd);
  if (!r.fields) return { error: r.error };
  const f = r.fields;
  const existing = await db.discoveryBrief.findUnique({ where: { roleId } });
  const manual = existing?.origin !== "jd";
  const prov = existing ? mergeProvenance(briefProvenance(existing), briefFields(existing), f, manual) : Object.fromEntries((Object.keys(BRIEF_FIELD_LABEL) as (keyof BriefFields)[]).map((k) => [k, { status: "manual" }]));
  const edited = fd.get("booleanEdited") === "1";
  const booleanQuery = edited ? str(fd, "booleanQuery", 4000) : buildBoolean(f);
  if (edited) {
    if (!booleanQuery) return { error: "The Boolean query is empty. Regenerate it from the fields or write one." };
    const bad = checkBoolean(booleanQuery);
    if (bad) return { error: `Boolean query: ${bad}` };
  }
  const data = {
    ...briefColumns(f),
    provenanceJson: JSON.stringify(prov),
    booleanQuery,
    booleanEdited: edited,
    booleanFieldsKey: edited ? str(fd, "booleanFieldsKey", 4000) || existing?.booleanFieldsKey || null : booleanKey(f),
    confirmedAt: new Date(),
    confirmedByName: auth.userName,
    updatedByName: auth.userName,
  };
  const brief = await db.discoveryBrief.upsert({ where: { roleId }, create: { orgId: auth.orgId, roleId, origin: "manual", ...data }, update: data });
  // A role created from an upload starts as "Untitled role (…)": adopt the confirmed name.
  if (role.title.startsWith("Untitled role") || (!role.location && f.location)) {
    await db.role.update({ where: { id: roleId }, data: { ...(role.title.startsWith("Untitled role") ? { title: f.roleName } : {}), ...(!role.location && f.location ? { location: f.location } : {}) } });
  }
  return { brief, fields: f };
}

/** Saves the reviewed fields (and optionally searches). Search always uses what was just confirmed. */
export async function saveBriefAndSearch(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const saved = await saveFields(auth, roleId, fd);
  if ("error" in saved) return { error: saved.error };
  if (str(fd, "intent", 10) !== "search") {
    refresh(roleId);
    return { ok: true, message: "Fields saved. Choose sources and search when you're ready." };
  }
  return runSearch(auth, roleId, saved.brief, saved.fields, fd);
}

type SourceStatus = { key: string; label: string; status: "ok" | "error" | "setup_required"; count: number; error?: string };

async function runSearch(auth: AuthContext, roleId: string, brief: { booleanQuery: string }, f: BriefFields, fd: FormData): Promise<ActionState> {
  const demo = str(fd, "mode", 10) === "demo";
  const keys = demo ? ["sample"] : fd.getAll("source").map(String);
  const chosen = keys.map((k) => connector(k)).filter((c): c is NonNullable<typeof c> => !!c && (demo ? c.kind === "sample" : c.kind !== "sample"));
  if (!chosen.length) return { error: demo ? "Demo mode isn't available because a live source is connected." : "Choose at least one connected source." };

  const filters: SearchFilters = {
    ...EMPTY_FILTERS,
    titles: [f.roleName],
    adjacent_titles: f.altTitles,
    skills_required: f.skillsRequired,
    skills_preferred: f.skillsPreferred,
    locations: f.location && f.workArrangement !== "remote" ? [f.location] : [],
    exclusions: f.exclusions,
  };
  const years = { min: f.minYears, max: f.maxYears };
  const last = await db.searchStrategy.findFirst({ where: { roleId }, orderBy: { version: "desc" } });
  const strategy = await db.searchStrategy.create({
    data: {
      orgId: auth.orgId,
      roleId,
      version: (last?.version ?? 0) + 1,
      request: "",
      filtersJson: JSON.stringify(filters),
      booleanQuery: brief.booleanQuery,
      planJson: JSON.stringify({ years, workArrangement: f.workArrangement }),
      generator: "discovery-brief",
      createdByName: auth.userName,
    },
  });

  // Each source runs independently. A failing source is reported; nothing is substituted for it.
  const statuses: SourceStatus[] = [];
  const batches: { key: string; label: string; retrievedAt: string; profiles: RawProfile[] }[] = [];
  let estimatedTotal: number | null = null;
  for (const c of chosen) {
    if (!c.configured()) {
      statuses.push({ key: c.key, label: c.label, status: "setup_required", count: 0, error: "Not connected" });
      continue;
    }
    try {
      const out = await c.search({ orgId: auth.orgId, roleId, filters, booleanQuery: brief.booleanQuery, years });
      batches.push({ key: c.key, label: c.label, retrievedAt: new Date().toISOString(), profiles: out.profiles });
      if (out.estimatedTotal != null) estimatedTotal = (estimatedTotal ?? 0) + out.estimatedTotal;
      statuses.push({ key: c.key, label: c.label, status: "ok", count: out.profiles.length });
    } catch (err) {
      logError("discover.source_failed", err, { source: c.key });
      statuses.push({ key: c.key, label: c.label, status: "error", count: 0, error: err instanceof SourceError ? err.message : `${c.label} couldn't be reached or returned an unexpected response.` });
    }
  }
  const merged = mergeAcrossSources(batches);
  const excluded = merged.filter((p) => p.excludedBy).length;
  const anyOk = statuses.some((s) => s.status === "ok");
  const run = await db.searchRun.create({
    data: {
      orgId: auth.orgId,
      roleId,
      strategyId: strategy.id,
      source: chosen.map((c) => c.key).join("+"),
      isDemo: demo,
      sourcesJson: JSON.stringify(statuses),
      status: anyOk ? "completed" : "failed",
      query: brief.booleanQuery,
      resultCount: merged.length - excluded,
      excludedCount: excluded,
      estimatedTotal,
      error: anyOk ? null : "No source returned results.",
      createdByName: auth.userName,
    },
  });
  if (merged.length)
    await db.sourcedProfile.createMany({
      data: merged.map((p) => ({
        orgId: auth.orgId,
        roleId,
        runId: run.id,
        source: p.sourceKey,
        sourceRecordId: p.sourceRecordId,
        sourceUrl: p.sourceUrl,
        sourcesJson: JSON.stringify(p.sources),
        displayName: p.displayName,
        currentTitle: p.currentTitle,
        currentCompany: p.currentCompany,
        location: p.location,
        fieldsJson: JSON.stringify(p.fields),
        signalsJson: JSON.stringify(p.signals),
        matchedSignals: p.signals.filter((s) => s.matched).length,
        totalSignals: p.signals.length,
        evidenceStatus: p.evidenceStatus,
        staleReason: p.staleReason,
        duplicateCandidateId: p.duplicateCandidateId,
        duplicateReason: p.duplicateReason,
        excludedBy: p.excludedBy,
        status: p.excludedBy ? "excluded" : "new",
      })),
    });
  await audit(auth, "discover.searched", {
    subjectType: "sourcing",
    subjectId: run.id,
    roleId,
    meta: { sources: run.source, demo, results: run.resultCount, failed: statuses.filter((s) => s.status !== "ok").length },
  });
  refresh(roleId);
  if (!anyOk) return { error: statuses.map((s) => `${s.label}: ${s.error}`).join(" · ") };
  return { ok: true, redirectTo: `/roles/${roleId}/discover?run=${run.id}#results` };
}
