"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { BRIEF_FIELD_LABEL, WORK_ARRANGEMENTS, booleanKey, buildBoolean, checkBoolean, splitList, type BriefFields, type Prov, type Provenance, type WorkArrangement } from "@/lib/discovery/brief";
import { suggestBriefFromJd } from "@/lib/discovery/extract";
import { briefColumns, briefFields, briefProvenance } from "@/lib/discovery/store";
import { logError } from "@/lib/log";
import { AiRequestError, AiUnavailableError, aiStatus, generateClientProfileWithAi, generateTargetCompaniesWithAi } from "@/lib/ai";
import { ClientProfileSchema, cleanTargetCompanies, keepSeenUrls, type ClientProfile, type DroppedCompany, type TargetCompany, type TargetCompanyInput } from "@/lib/discovery/target-companies";
import { executeSearch } from "./search-run";
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
    data: {
      orgId: auth.orgId,
      title: f.roleName,
      location: f.location ?? "",
      status: "draft",
      createdById: auth.userId,
      clientCompanyName: str(fd, "clientCompanyName", 160) || null,
      clientCompanyWebsite: str(fd, "clientCompanyWebsite", 300) || null,
    },
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
  const minRaw = str(fd, "minRequiredSkills", 4);
  const minRequiredSkills = minRaw === "" ? null : Math.max(0, Math.min(50, Math.round(Number(minRaw)) || 0));
  const data = {
    ...briefColumns(f),
    minRequiredSkills,
    aiRankTop: fd.get("aiRankTop") === "1",
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

async function runSearch(auth: AuthContext, roleId: string, brief: { booleanQuery: string }, f: BriefFields, fd: FormData): Promise<ActionState> {
  const demo = str(fd, "mode", 10) === "demo";
  const keys = demo ? ["sample"] : fd.getAll("source").map(String);
  let targetCompanies: string[] = [];
  try {
    const raw = JSON.parse(str(fd, "targetCompanies", 20000) || "[]") as unknown;
    if (Array.isArray(raw)) targetCompanies = raw.filter((x): x is string => typeof x === "string").map((x) => x.slice(0, 160));
  } catch {
    /* no selection */
  }
  const out = await executeSearch(auth, roleId, brief, f, { demo, keys, targetCompanies });
  if ("error" in out) return { error: out.error };
  refresh(roleId);
  if (!out.anyOk) return { error: out.statuses.map((s) => `${s.label}: ${s.error}`).join(" · ") };
  return { ok: true, redirectTo: `/roles/${roleId}/discover?run=${out.runId}#results` };
}

// ---------- Target companies (AI suggests; the recruiter picks before searching) ----------

export type TargetCompaniesView = {
  aiConfigured: boolean;
  client: { name: string | null; website: string | null };
  set: { clientProfile: ClientProfile; companies: TargetCompany[]; dropped: DroppedCompany[]; model: string; webSearch: boolean; generatedAt: string; generatedByName: string } | null;
  error?: string;
};

async function targetInput(auth: AuthContext, roleId: string): Promise<{ input: TargetCompanyInput; client: { name: string | null; website: string | null } }> {
  const role = await ownRole(auth, roleId);
  const [criteria, brief] = await Promise.all([
    db.criterion.findMany({ where: { roleId, orgId: auth.orgId, status: "approved" }, select: { name: true, importance: true, kind: true }, orderBy: { position: "asc" } }),
    db.discoveryBrief.findUnique({ where: { roleId } }),
  ]);
  const f = brief ? briefFields(brief) : null;
  const client = { name: role.clientCompanyName, website: role.clientCompanyWebsite };
  return {
    client,
    input: {
      roleTitle: f?.roleName || role.title,
      criteria: criteria.slice(0, 40),
      brief: f ? { altTitles: f.altTitles, skillsRequired: f.skillsRequired, skillsPreferred: f.skillsPreferred, location: f.location || role.location || null, workArrangement: f.workArrangement } : { altTitles: [], skillsRequired: [], skillsPreferred: [], location: role.location || null, workArrangement: null },
      client: { name: role.clientCompanyName, website: role.clientCompanyWebsite, notes: role.clientCompanyNotes },
      exclusions: f?.exclusions ?? [],
    },
  };
}

function setView(row: { clientProfileJson: string; companiesJson: string; droppedJson: string; model: string; webSearch: boolean; generatedAt: Date; generatedByName: string }): NonNullable<TargetCompaniesView["set"]> {
  return {
    clientProfile: JSON.parse(row.clientProfileJson),
    companies: JSON.parse(row.companiesJson),
    dropped: JSON.parse(row.droppedJson),
    model: row.model,
    webSearch: row.webSearch,
    generatedAt: row.generatedAt.toISOString(),
    generatedByName: row.generatedByName,
  };
}

/** Opens the popup: the stored list, or a new one when there is none yet. */
export async function getTargetCompanies(roleId: string): Promise<TargetCompaniesView> {
  const auth = await requireAuth();
  const { client } = await targetInput(auth, roleId);
  const configured = aiStatus().configured;
  const stored = await db.targetCompanySet.findUnique({ where: { roleId } });
  if (stored && stored.orgId === auth.orgId) return { aiConfigured: configured, client, set: setView(stored) };
  if (!configured) return { aiConfigured: false, client, set: null };
  return generateTargets(auth, roleId, null);
}

/** "Regenerate", or "Update profile and regenerate" with the recruiter's corrected profile. */
export async function regenerateTargetCompanies(roleId: string, correctedProfile?: unknown): Promise<TargetCompaniesView> {
  const auth = await requireAuth();
  let profile: ClientProfile | null = null;
  if (correctedProfile !== undefined) {
    const p = ClientProfileSchema.safeParse(correctedProfile);
    if (!p.success) return { aiConfigured: aiStatus().configured, client: { name: null, website: null }, set: null, error: "Check the company profile: each field is required and the bands must be one of the listed options." };
    profile = { ...p.data, edited: true };
  }
  return generateTargets(auth, roleId, profile);
}

async function generateTargets(auth: AuthContext, roleId: string, corrected: ClientProfile | null): Promise<TargetCompaniesView> {
  const { input, client } = await targetInput(auth, roleId);
  const ai = aiStatus();
  if (!ai.configured) return { aiConfigured: false, client, set: null };
  try {
    let profile = corrected;
    let profileWeb = false;
    if (!profile) {
      const step1 = await generateClientProfileWithAi(input);
      const seen = new Set(step1.urls);
      profile = {
        industry: step1.output.industry.slice(0, 120),
        domain: step1.output.domain.slice(0, 120),
        product: step1.output.product.slice(0, 240),
        headcount_band: step1.output.headcount_band,
        revenue_band: step1.output.revenue_band,
        source_urls: keepSeenUrls(step1.output.source_urls, seen),
      };
      profileWeb = step1.webSearch;
    }
    const step2 = await generateTargetCompaniesWithAi(input, profile);
    const seen = new Set(step2.urls);
    // Links are kept only if the provider's web search actually returned them.
    const raw = step2.output.companies.map((c) => ({ ...c, source_urls: step2.webSearch ? keepSeenUrls(c.source_urls, seen) : [] }));
    const { companies, dropped } = cleanTargetCompanies(raw, { clientName: client.name, clientWebsite: client.website, exclusions: input.exclusions, limit: 30 });
    const data = {
      clientProfileJson: JSON.stringify(profile),
      companiesJson: JSON.stringify(companies),
      droppedJson: JSON.stringify(dropped),
      model: `${ai.provider}:${ai.model}`,
      webSearch: step2.webSearch || profileWeb,
      generatedByName: auth.userName,
      generatedAt: new Date(),
    };
    const row = await db.targetCompanySet.upsert({ where: { roleId }, create: { orgId: auth.orgId, roleId, ...data }, update: data });
    await audit(auth, "discover.target_companies_generated", { subjectType: "role", subjectId: roleId, roleId, meta: { companies: companies.length, dropped: dropped.length, webSearch: data.webSearch, profileEdited: !!corrected } });
    return { aiConfigured: true, client, set: setView(row) };
  } catch (err) {
    const message = err instanceof AiRequestError || err instanceof AiUnavailableError ? err.message : "The AI couldn't suggest companies this time.";
    if (!(err instanceof AiRequestError)) logError("discover.target_companies_failed", err, { roleId });
    const stored = await db.targetCompanySet.findUnique({ where: { roleId } });
    return { aiConfigured: true, client, set: stored ? setView(stored) : null, error: `${message} Try again, or search without target companies.` };
  }
}
