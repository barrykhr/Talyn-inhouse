"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, SEARCH_ENGINE_VERSION, aiStatus, planSearchWithAi, type SearchPlan } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import Papa from "papaparse";
import { ExternalRecord, connector, profileFromRecord, type SearchOutcome } from "@/lib/sourcing/connectors";
import { EMPTY_FILTERS, parseList, toBoolean, type SearchFilters } from "@/lib/sourcing/filters";
import { str, type ActionState } from "./form";
import { attach } from "./pipeline";
import { ownRole } from "./scope";

export type PlanResult = { ok?: boolean; error?: string; notice?: string; plan?: SearchPlan & { boolean: string; generator: string } };

async function approvedIcp(orgId: string, roleId: string) {
  return db.icp.findFirst({ where: { orgId, roleId, status: "approved" }, include: { items: { where: { status: "approved" }, orderBy: { position: "asc" } } } });
}

/** Deterministic plan from the approved ICP (used when AI is off or fails). */
function planFromIcp(items: { category: string; value: string }[]): SearchPlan {
  const pick = (...cats: string[]) => items.filter((i) => cats.includes(i.category)).map((i) => i.value);
  const filters: SearchFilters = {
    titles: pick("target_title", "adjacent_title"),
    skills_required: pick("skill_essential"),
    skills_preferred: pick("skill_preferred"),
    locations: pick("location"),
    seniority: pick("seniority"),
    industries: pick("industry"),
    exclusions: pick("exclusion"),
  };
  const map: Record<string, keyof SearchFilters> = {
    target_title: "titles",
    adjacent_title: "titles",
    skill_essential: "skills_required",
    skill_preferred: "skills_preferred",
    location: "locations",
    seniority: "seniority",
    industry: "industries",
    exclusion: "exclusions",
  };
  return {
    filters,
    mapping: items.map((i) => ({
      phrase: i.value,
      field: map[i.category] ?? "not_used",
      value: i.value,
      note: map[i.category] ? `Approved profile item (${i.category.replace(/_/g, " ")}).` : "Profile context; not a search filter.",
    })),
    explanations: [],
    plan: { target_titles: pick("target_title"), adjacent_profiles: pick("adjacent_title", "transferable"), company_contexts: pick("industry"), notes: "" },
  };
}

/** Proposes filters + Boolean from the approved ICP and an optional plain-language request. Not saved until the recruiter saves it. */
export async function planSearch(roleId: string, request: string): Promise<PlanResult> {
  const auth = await requireAuth();
  const role = await ownRole(auth, roleId);
  const icp = await approvedIcp(auth.orgId, roleId);
  if (!icp) return { error: "Approve the Ideal Candidate Profile first." };
  const items = icp.items.map((i) => ({ category: i.category, value: i.value }));
  const ai = aiStatus();
  try {
    if (!ai.configured) throw new AiUnavailableError();
    const p = await planSearchWithAi({ roleTitle: role.title, request: request.slice(0, 2000), icp: items });
    // Exclusions may only come from the approved profile or the recruiter's own words.
    const allowed = new Set(items.filter((i) => i.category === "exclusion").map((i) => i.value.toLowerCase()));
    p.filters.exclusions = p.filters.exclusions.filter((e) => allowed.has(e.toLowerCase()) || request.toLowerCase().includes(e.toLowerCase()));
    return { ok: true, plan: { ...p, boolean: toBoolean(p.filters), generator: `ai:${ai.provider}:${ai.model}/${SEARCH_ENGINE_VERSION}` } };
  } catch (err) {
    if (!(err instanceof AiUnavailableError || err instanceof AiRequestError)) logError("search.plan_failed", err, { roleId });
    const p = planFromIcp(items);
    return {
      ok: true,
      notice: request.trim()
        ? "AI is unavailable, so your request text wasn't interpreted. Filters come from the approved profile — edit them below."
        : "Built from the approved profile (not AI). Edit the filters below.",
      plan: { ...p, boolean: toBoolean(p.filters), generator: "parser:search-from-icp-v1" },
    };
  }
}

const FilterSchema = z.object({
  titles: z.array(z.string().max(120)),
  skills_required: z.array(z.string().max(120)),
  skills_preferred: z.array(z.string().max(120)),
  locations: z.array(z.string().max(120)),
  seniority: z.array(z.string().max(120)),
  industries: z.array(z.string().max(120)),
  exclusions: z.array(z.string().max(120)),
});

/** Saves the recruiter-edited strategy as a new version. */
export async function saveStrategy(roleId: string, _prev: ActionState, fd: FormData): Promise<ActionState & { strategyId?: string }> {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  const icp = await approvedIcp(auth.orgId, roleId);
  if (!icp) return { error: "Approve the Ideal Candidate Profile first." };
  const filters = FilterSchema.parse(Object.fromEntries(Object.keys(EMPTY_FILTERS).map((k) => [k, parseList(str(fd, `f_${k}`, 3000))])));
  if (!filters.titles.length && !filters.skills_required.length) return { error: "Add at least one title or required skill." };
  // Exclusions must be job-related and recruiter-approved: only allow ones present in the approved ICP or typed here deliberately.
  const booleanQuery = str(fd, "booleanQuery", 4000) || toBoolean(filters);
  const last = await db.searchStrategy.findFirst({ where: { roleId }, orderBy: { version: "desc" } });
  const s = await db.searchStrategy.create({
    data: {
      orgId: auth.orgId,
      roleId,
      icpId: icp.id,
      icpVersion: icp.version,
      version: (last?.version ?? 0) + 1,
      request: str(fd, "request", 2000),
      filtersJson: JSON.stringify(filters),
      booleanQuery,
      mappingJson: str(fd, "mappingJson", 20000) || "[]",
      explanationsJson: str(fd, "explanationsJson", 20000) || "[]",
      planJson: str(fd, "planJson", 20000) || "{}",
      generator: str(fd, "generator", 200) || "recruiter",
      createdByName: auth.userName,
    },
  });
  await audit(auth, "search.saved", { subjectType: "sourcing", subjectId: s.id, roleId, meta: { version: s.version, icpVersion: icp.version } });
  revalidatePath(`/roles/${roleId}/sourcing`);
  return { ok: true, message: `Saved as search v${s.version}.`, strategyId: s.id };
}

/** Runs a saved strategy against one authorized source. Results are for review only. */
type StrategyRow = { id: string; roleId: string; version: number };

/** Persists a completed run and its profiles. Excluded profiles are set aside, never deleted. */
async function storeRun(auth: AuthContext, strategy: StrategyRow, sourceKey: string, out: SearchOutcome) {
  const excluded = out.profiles.filter((p) => p.excludedBy).length;
  const run = await db.searchRun.create({
    data: {
      orgId: auth.orgId,
      roleId: strategy.roleId,
      strategyId: strategy.id,
      source: sourceKey,
      status: "completed",
      query: out.query,
      resultCount: out.profiles.length - excluded,
      excludedCount: excluded,
      estimatedTotal: out.estimatedTotal,
      createdByName: auth.userName,
    },
  });
  if (out.profiles.length)
    await db.sourcedProfile.createMany({
      data: out.profiles.map((p) => ({
        orgId: auth.orgId,
        roleId: strategy.roleId,
        runId: run.id,
        source: sourceKey,
        sourceRecordId: p.sourceRecordId,
        sourceUrl: p.sourceUrl,
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
  return { run, excluded };
}

/** Sourced field keys → candidate profile fields (for provenance labels). */
const PROFILE_KEY: Record<string, string> = { current_title: "currentTitle", current_company: "currentCompany", location: "location", email: "email", linkedin_url: "linkedinUrl" };

const MAX_IMPORT_BYTES = 4 * 1024 * 1024;
const MAX_IMPORT_ROWS = 1000;
const COL: Record<string, string[]> = {
  id: ["id", "profile_id", "record_id"],
  name: ["name", "full_name", "fullname", "candidate_name"],
  title: ["title", "current_title", "headline", "job_title"],
  company: ["company", "current_company", "employer"],
  location: ["location", "city"],
  email: ["email", "email_address"],
  linkedinUrl: ["linkedin_url", "linkedin"],
  url: ["profile_url", "url", "source_url"],
  skills: ["skills"],
  summary: ["summary", "about", "profile_text"],
  updatedAt: ["updated_at", "last_updated", "profile_updated"],
};

/**
 * Imports profiles exported from a source the organization is licensed to use (e.g. a
 * recruiting tool's export or a referral list). The recruiter must name the source and confirm
 * the licence. Rows are matched against the saved search but nothing is filtered out silently.
 */
export async function importSourcingFile(strategyId: string, _prev: ActionState, fd: FormData): Promise<ActionState> {
  const auth = await requireAuth();
  const strategy = await db.searchStrategy.findFirst({ where: { id: strategyId, orgId: auth.orgId } });
  if (!strategy) return { error: "Search not found." };
  const sourceName = str(fd, "sourceName").slice(0, 120);
  if (!sourceName) return { error: "Name the source this export came from." };
  if (fd.get("attest") !== "on") return { error: "Confirm your organization is licensed to use this data for recruiting." };
  const file = fd.get("file");
  if (!(file instanceof File) || !file.size) return { error: "Choose a CSV file." };
  if (file.size > MAX_IMPORT_BYTES) return { error: "The file is larger than 4 MB. Split it and import in parts." };
  if (!/\.csv$/i.test(file.name) && file.type !== "text/csv") return { error: "Upload a .csv file." };
  const parsed = Papa.parse<Record<string, string>>(await file.text(), { header: true, skipEmptyLines: true, transformHeader: (h) => h.trim().toLowerCase().replace(/[\s-]+/g, "_") });
  const rows = parsed.data;
  if (!rows.length) return { error: "The file has no rows." };
  if (rows.length > MAX_IMPORT_ROWS) return { error: `The file has ${rows.length} rows; import up to ${MAX_IMPORT_ROWS} at a time.` };
  const headers = parsed.meta.fields ?? [];
  const col = (k: string) => COL[k].find((h) => headers.includes(h));
  if (!col("name")) return { error: "The file needs a name (or full_name) column." };
  const filters = JSON.parse(strategy.filtersJson) as SearchFilters;
  const label = `${sourceName} (imported file)`;
  const profiles = [];
  let skipped = 0;
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const get = (k: string) => {
      const c = col(k);
      const v = c ? r[c]?.trim() : "";
      return v ? v : null;
    };
    const rec = ExternalRecord.safeParse({
      id: get("id") ?? `${file.name}#${i + 2}`,
      name: get("name"),
      title: get("title"),
      company: get("company"),
      location: get("location"),
      email: get("email")?.toLowerCase(),
      linkedinUrl: get("linkedinUrl"),
      url: get("url"),
      skills: get("skills")?.split(/[;,|]/).map((x) => x.trim()).filter(Boolean),
      summary: get("summary"),
      updatedAt: get("updatedAt"),
    });
    if (!rec.success) {
      skipped++;
      continue;
    }
    const p = await profileFromRecord(auth.orgId, rec.data, filters, label, { relevanceGate: false });
    if (p) profiles.push(p);
  }
  if (!profiles.length) return { error: `No usable rows. ${skipped} row${skipped === 1 ? "" : "s"} had a missing name or an invalid email/URL.` };
  const { run, excluded } = await storeRun(auth, strategy, "file", { profiles, estimatedTotal: null, query: `Imported from ${sourceName} · ${file.name} · ${rows.length} rows` });
  await audit(auth, "sourcing.file_imported", { subjectType: "sourcing", subjectId: run.id, roleId: strategy.roleId, meta: { rows: rows.length, imported: profiles.length, skipped, excluded } });
  revalidatePath(`/roles/${strategy.roleId}/sourcing`);
  return { ok: true, message: `${run.resultCount} profiles to review${skipped ? ` · ${skipped} rows skipped (missing name or invalid email/URL)` : ""}${excluded ? ` · ${excluded} matched your approved exclusions` : ""}.`, redirectTo: `/roles/${strategy.roleId}/sourcing?run=${run.id}#results` };
}

export async function runSearch(strategyId: string, sourceKey: string): Promise<ActionState> {
  const auth = await requireAuth();
  const strategy = await db.searchStrategy.findFirst({ where: { id: strategyId, orgId: auth.orgId } });
  if (!strategy) return { error: "Search not found." };
  const src = connector(sourceKey);
  if (!src) return { error: "Unknown source." };
  const filters = JSON.parse(strategy.filtersJson) as SearchFilters;
  if (!src.configured()) {
    await db.searchRun.create({ data: { orgId: auth.orgId, roleId: strategy.roleId, strategyId, source: src.key, status: "setup_required", error: src.setupHint, createdByName: auth.userName } });
    revalidatePath(`/roles/${strategy.roleId}/sourcing`);
    return { error: `${src.label} isn't connected.` };
  }
  try {
    const out = await src.search({ orgId: auth.orgId, roleId: strategy.roleId, filters, booleanQuery: strategy.booleanQuery });
    const { run, excluded } = await storeRun(auth, strategy, src.key, out);
    await audit(auth, "search.run", { subjectType: "sourcing", subjectId: run.id, roleId: strategy.roleId, meta: { source: src.key, version: strategy.version, results: run.resultCount, excluded } });
    revalidatePath(`/roles/${strategy.roleId}/sourcing`);
    return { ok: true, message: `${run.resultCount} profile${run.resultCount === 1 ? "" : "s"} to review${excluded ? ` · ${excluded} matched your approved exclusions` : ""}.` };
  } catch (err) {
    logError("search.run_failed", err, { source: src.key });
    await db.searchRun.create({ data: { orgId: auth.orgId, roleId: strategy.roleId, strategyId, source: src.key, status: "failed", error: "The search failed.", createdByName: auth.userName } });
    revalidatePath(`/roles/${strategy.roleId}/sourcing`);
    return { error: "The search failed. Try again." };
  }
}

async function ownProfile(orgId: string, id: string) {
  return db.sourcedProfile.findFirst({ where: { id, orgId } });
}

/** Saves a sourced profile to the role's pipeline (at "New"). Never assesses or moves anyone automatically. */
export async function saveProfileToRole(profileId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const p = await ownProfile(auth.orgId, profileId);
  if (!p) return { error: "Profile not found." };
  let candidateId: string;
  if (p.source === "talyn") {
    const c = await db.candidate.findFirst({ where: { id: p.sourceRecordId, orgId: auth.orgId }, select: { id: true } });
    if (!c) return { error: "That candidate no longer exists in Talyn." };
    candidateId = c.id;
  } else if (p.duplicateCandidateId) {
    candidateId = p.duplicateCandidateId; // reuse the existing record rather than creating a duplicate
  } else {
    // External profile: create a minimal candidate with source-attributed fields only.
    const fields = JSON.parse(p.fieldsJson) as Record<string, { value: string }>;
    const c = await db.candidate.create({
      data: {
        orgId: auth.orgId,
        fullName: p.displayName,
        currentTitle: p.currentTitle,
        currentCompany: p.currentCompany,
        location: p.location,
        // Contact details only when the source itself provided them — never guessed.
        email: fields.email?.value ?? null,
        linkedinUrl: fields.linkedin_url?.value ?? null,
        source: `sourced:${p.source}`,
        fieldOriginsJson: JSON.stringify({ fullName: "sourced", ...Object.fromEntries(Object.keys(fields).flatMap((k) => (PROFILE_KEY[k] ? [[PROFILE_KEY[k], "sourced"]] : []))) }),
      },
    });
    candidateId = c.id;
  }
  const app = await attach(auth, candidateId, p.roleId);
  await db.sourcedProfile.update({ where: { id: profileId }, data: { status: "saved", savedApplicationId: app.id, reviewedByName: auth.userName, reviewedAt: new Date() } });
  await audit(auth, "sourcing.saved_to_role", { subjectType: "sourcing", subjectId: profileId, candidateId, roleId: p.roleId, applicationId: app.id, meta: { source: p.source } });
  revalidatePath(`/roles/${p.roleId}/sourcing`);
  revalidatePath(`/roles/${p.roleId}`);
  return { ok: true };
}

/** Recruiter feedback on a result. Dismissing hides nothing elsewhere and records no decision. */
export async function reviewProfile(profileId: string, input: { feedback?: "useful" | "irrelevant" | null; reason?: string; dismiss?: boolean }): Promise<ActionState> {
  const auth = await requireAuth();
  const p = await ownProfile(auth.orgId, profileId);
  if (!p) return { error: "Profile not found." };
  await db.sourcedProfile.update({
    where: { id: profileId },
    data: {
      ...(input.feedback !== undefined ? { feedback: input.feedback, feedbackReason: input.reason?.slice(0, 200) ?? null } : {}),
      ...(input.dismiss ? { status: "dismissed" } : {}),
      reviewedByName: auth.userName,
      reviewedAt: new Date(),
    },
  });
  await audit(auth, "sourcing.feedback", { subjectType: "sourcing", subjectId: profileId, roleId: p.roleId, meta: { feedback: input.feedback ?? null, dismissed: !!input.dismiss, reason: input.reason ?? null } });
  revalidatePath(`/roles/${p.roleId}/sourcing`);
  return { ok: true };
}
