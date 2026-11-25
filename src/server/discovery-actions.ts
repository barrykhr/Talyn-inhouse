"use server";

import { revalidatePath } from "next/cache";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { BRIEF_FIELD_LABEL, WORK_ARRANGEMENTS, booleanKey, buildBoolean, checkBoolean, splitList, type BriefFields, type Prov, type Provenance, type WorkArrangement } from "@/lib/discovery/brief";
import { suggestBriefFromJd } from "@/lib/discovery/extract";
import { briefColumns, briefFields, briefProvenance } from "@/lib/discovery/store";
import { logError } from "@/lib/log";
import { AiRequestError, AiUnavailableError, aiStatus, generateClientProfileWithAi, generateTargetCompaniesWithAi, runStructuredFor } from "@/lib/ai";
import { ClientProfileSchema, EMPTY_PROFILE, cleanSelection, cleanTargetCompanies, keepSeenUrls, parseSelection, type ClientProfile, type DroppedCompany, type TargetCompany, type TargetCompanyInput } from "@/lib/discovery/target-companies";
import { executeSearch } from "./search-run";
import { parseSynonyms } from "@/lib/sourcing/filters";
import { DescribeSchema, SynonymsSchema, describePrompt, synonymsPrompt, toDescribedFields, type DescribedFields } from "@/lib/discovery/semantic";
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
    // Alternative names the recruiter kept, only for terms still in the fields.
    ...(fd.has("synonyms") ? { synonymsJson: JSON.stringify(parseSynonyms(str(fd, "synonyms", 20000), [f.roleName, ...f.altTitles, ...f.skillsRequired, ...f.skillsPreferred])) } : {}),
    ...(fd.has("describedAs") ? { describedAs: str(fd, "describedAs", 2000) || null } : {}),
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

async function runSearch(auth: AuthContext, roleId: string, brief: { booleanQuery: string; synonymsJson?: string | null }, f: BriefFields, fd: FormData): Promise<ActionState> {
  const demo = str(fd, "mode", 10) === "demo";
  const keys = demo ? ["sample"] : fd.getAll("source").map(String);
  let targetCompanies: string[] = [];
  const chosen = str(fd, "targetCompanies", 20000);
  if (!chosen) {
    // No choice made in the popup: use the selection saved on the role, if any.
    const saved = await db.targetCompanySet.findUnique({ where: { roleId }, select: { orgId: true, selectedJson: true } });
    if (saved && saved.orgId === auth.orgId) targetCompanies = parseSelection(saved.selectedJson);
  } else {
    try {
      targetCompanies = cleanSelection(JSON.parse(chosen));
    } catch {
      /* unreadable: search without target companies */
    }
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
  set: {
    clientProfile: ClientProfile;
    companies: TargetCompany[];
    dropped: DroppedCompany[];
    model: string;
    webSearch: boolean;
    generatedAt: string;
    generatedByName: string;
    /** Names the recruiter chose and saved; searches use them. */
    selected: string[];
    selectedByName: string | null;
    selectedAt: string | null;
  } | null;
  error?: string;
  /** The popup should generate a list now (none stored yet). */
  needsGeneration?: boolean;
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

function setView(row: {
  clientProfileJson: string;
  companiesJson: string;
  droppedJson: string;
  model: string;
  webSearch: boolean;
  generatedAt: Date;
  generatedByName: string;
  selectedJson: string;
  selectedByName: string | null;
  selectedAt: Date | null;
}): NonNullable<TargetCompaniesView["set"]> {
  return {
    selected: parseSelection(row.selectedJson),
    selectedByName: row.selectedByName,
    selectedAt: row.selectedAt?.toISOString() ?? null,
    clientProfile: JSON.parse(row.clientProfileJson),
    companies: JSON.parse(row.companiesJson),
    dropped: JSON.parse(row.droppedJson),
    model: row.model,
    webSearch: row.webSearch,
    generatedAt: row.generatedAt.toISOString(),
    generatedByName: row.generatedByName,
  };
}

/** Saves which companies the recruiter chose. Searches, including the daily automatic one, use them. */
export async function saveTargetSelection(roleId: string, names: unknown): Promise<TargetCompaniesView> {
  const auth = await requireAuth();
  const { client } = await targetInput(auth, roleId);
  const configured = aiStatus().configured;
  const stored = await db.targetCompanySet.findUnique({ where: { roleId } });
  const list = cleanSelection(names);
  if (!stored || stored.orgId !== auth.orgId) {
    if (!list.length) return { aiConfigured: configured, client, set: null };
    // Companies added by hand before any AI list exists: keep them in an empty set.
    const row = await db.targetCompanySet.create({
      data: { orgId: auth.orgId, roleId, clientProfileJson: JSON.stringify(EMPTY_PROFILE), model: "none", generatedByName: auth.userName, selectedJson: JSON.stringify(list), selectedByName: auth.userName, selectedAt: new Date() },
    });
    await audit(auth, "discover.target_companies_selected", { subjectType: "role", subjectId: roleId, roleId, meta: { selected: list.length } });
    revalidatePath(`/roles/${roleId}/discover`);
    return { aiConfigured: configured, client, set: setView(row) };
  }
  const row = await db.targetCompanySet.update({ where: { roleId }, data: { selectedJson: JSON.stringify(list), selectedByName: auth.userName, selectedAt: new Date() } });
  await audit(auth, "discover.target_companies_selected", { subjectType: "role", subjectId: roleId, roleId, meta: { selected: list.length } });
  revalidatePath(`/roles/${roleId}/discover`);
  return { aiConfigured: configured, client, set: setView(row) };
}

/** Opens the popup: the stored list, or a new one when there is none yet. */
export async function getTargetCompanies(roleId: string, opts: { generate?: boolean } = {}): Promise<TargetCompaniesView> {
  const auth = await requireAuth();
  const { client } = await targetInput(auth, roleId);
  const configured = aiStatus().configured;
  const stored = await db.targetCompanySet.findUnique({ where: { roleId } });
  // A set holding only hand-added companies gets an AI list on first open (the selection is kept).
  if (stored && stored.orgId === auth.orgId && (stored.model !== "none" || !configured)) return { aiConfigured: configured, client, set: setView(stored) };
  if (!configured) return { aiConfigured: false, client, set: null };
  // The popup generates in two visible steps (profile, then companies); other callers generate in one.
  if (opts.generate === false) return { aiConfigured: true, client, set: stored && stored.orgId === auth.orgId ? setView(stored) : null, needsGeneration: true };
  return generateTargets(auth, roleId, null);
}

/** Step 1 of generating: a profile of the client company (not saved until step 2 succeeds). */
export async function draftClientProfile(roleId: string): Promise<{ profile: ClientProfile } | { error: string }> {
  const auth = await requireAuth();
  const { input } = await targetInput(auth, roleId);
  if (!aiStatus().configured) return { error: "Suggestions need an AI provider." };
  try {
    const step1 = await generateClientProfileWithAi(input);
    const seen = new Set(step1.urls);
    return {
      profile: {
        industry: step1.output.industry.slice(0, 120),
        domain: step1.output.domain.slice(0, 120),
        product: step1.output.product.slice(0, 240),
        headcount_band: step1.output.headcount_band,
        revenue_band: step1.output.revenue_band,
        source_urls: keepSeenUrls(step1.output.source_urls, seen),
      },
    };
  } catch (err) {
    if (!(err instanceof AiRequestError)) logError("discover.client_profile_failed", err, { roleId });
    return { error: `${err instanceof AiRequestError || err instanceof AiUnavailableError ? err.message : "The AI couldn't profile the client company this time."} Try again, or search without target companies.` };
  }
}

/** Step 2: companies like the client, measured against the profile from step 1 (kept as the AI wrote it). */
export async function suggestCompaniesFrom(roleId: string, profile: unknown): Promise<TargetCompaniesView> {
  const auth = await requireAuth();
  const p = ClientProfileSchema.safeParse(profile);
  if (!p.success) return { aiConfigured: aiStatus().configured, client: { name: null, website: null }, set: null, error: "The client company profile was incomplete. Try again." };
  const urls = Array.isArray((profile as { source_urls?: unknown }).source_urls) ? ((profile as { source_urls: unknown[] }).source_urls.filter((u) => typeof u === "string").slice(0, 5) as string[]) : [];
  return generateTargets(auth, roleId, { ...p.data, source_urls: urls });
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

// ---------- Search by meaning: a plain-English description and alternative names ----------

/** Turns "describe the person" into search fields for the recruiter to check. Nothing is saved. */
export async function describeToFields(roleId: string, text: string): Promise<{ fields?: DescribedFields; error?: string }> {
  const auth = await requireAuth();
  const role = await ownRole(auth, roleId);
  const t = (text ?? "").trim().slice(0, 2000);
  if (t.length < 10) return { error: "Describe the person in a sentence or two first." };
  if (!aiStatus().configured) return { error: "This needs an AI provider. Fill in the fields yourself, or connect one under Integrations." };
  try {
    const { system, user } = describePrompt(t, role.title);
    const out = await runStructuredFor({ system, user, schema: DescribeSchema, name: "describe_person", maxTokens: 3000 });
    await audit(auth, "discover.described", { subjectType: "role", subjectId: roleId, roleId, meta: { chars: t.length } });
    return { fields: toDescribedFields(out) };
  } catch (err) {
    if (!(err instanceof AiRequestError || err instanceof AiUnavailableError)) logError("discover.describe_failed", err, { roleId });
    return { error: err instanceof AiRequestError ? err.message : "Talyn couldn't read that description. Try again, or fill in the fields yourself." };
  }
}

/** Suggests other names for the role's titles and skills ("Go" → "Golang"). The recruiter keeps or removes each. */
export async function suggestSynonyms(roleId: string, terms: { titles: string[]; skills: string[] }): Promise<{ synonyms?: Record<string, string[]>; error?: string }> {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  const titles = (terms?.titles ?? []).filter((x) => typeof x === "string" && x.trim()).slice(0, 10);
  const skills = (terms?.skills ?? []).filter((x) => typeof x === "string" && x.trim()).slice(0, 30);
  if (!titles.length && !skills.length) return { error: "Add a role name or skills first." };
  if (!aiStatus().configured) return { error: "This needs an AI provider. You can still type alternatives yourself." };
  try {
    const { system, user } = synonymsPrompt(titles, skills);
    const out = await runStructuredFor({ system, user, schema: SynonymsSchema, name: "search_synonyms", maxTokens: 3000 });
    const raw = Object.fromEntries(out.items.map((i) => [i.term, i.alternatives]));
    return { synonyms: parseSynonyms(JSON.stringify(raw), [...titles, ...skills]) };
  } catch (err) {
    if (!(err instanceof AiRequestError || err instanceof AiUnavailableError)) logError("discover.synonyms_failed", err, { roleId });
    return { error: err instanceof AiRequestError ? err.message : "Talyn couldn't suggest alternatives this time." };
  }
}

export type SearchChip = { kind: "role" | "title" | "skill" | "years" | "location" | "work" | "need"; label: string };

/**
 * How a plain-English people search was read, as chips the recruiter can remove. Display only:
 * the search itself compares meaning, so a wrong reading never filters anyone out.
 */
export async function interpretSearch(text: string): Promise<{ chips: SearchChip[] } | { error: string }> {
  await requireAuth();
  const t = (text ?? "").trim().slice(0, 500);
  if (t.length < 3) return { chips: [] };
  if (!aiStatus().configured) return { error: "AI isn't set up, so the search can't show how it read your words." };
  try {
    const { system, user } = describePrompt(t, "(not given: a people search across all roles)");
    const d = toDescribedFields(await runStructuredFor({ system, user, schema: DescribeSchema, name: "describe_person", maxTokens: 2000 }));
    const chips: SearchChip[] = [];
    if (d.roleName) chips.push({ kind: "role", label: d.roleName });
    for (const x of d.altTitles.slice(0, 2)) chips.push({ kind: "title", label: x });
    for (const x of [...d.skillsRequired, ...d.skillsPreferred].slice(0, 8)) chips.push({ kind: "skill", label: x });
    if (d.minYears !== null || d.maxYears !== null) chips.push({ kind: "years", label: d.maxYears === null ? `${d.minYears}+ years` : d.minYears === null ? `Up to ${d.maxYears} years` : `${d.minYears}–${d.maxYears} years` });
    if (d.location) chips.push({ kind: "location", label: d.location });
    if (d.workArrangement) chips.push({ kind: "work", label: d.workArrangement === "onsite" ? "On-site" : d.workArrangement === "hybrid" ? "Hybrid" : "Remote" });
    for (const x of d.otherNeeds.slice(0, 3)) chips.push({ kind: "need", label: x });
    return { chips };
  } catch (err) {
    if (!(err instanceof AiRequestError || err instanceof AiUnavailableError)) logError("search.interpret_failed", err);
    return { error: "Couldn't show how the search was read this time. Results aren't affected." };
  }
}
