"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { AiRequestError, AiUnavailableError, SEARCH_ENGINE_VERSION, aiStatus, planSearchWithAi, type SearchPlan } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth, type AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import Papa from "papaparse";
import { ExternalRecord, profileFromRecord, sourceLabel, type SearchOutcome } from "@/lib/sourcing/connectors";
import { EMPTY_FILTERS, parseFilters, parseList, toBoolean, type SearchFilters } from "@/lib/sourcing/filters";
import { str, type ActionState } from "./form";
import { attach } from "./pipeline";
import { ownRole } from "./scope";

type Plan = Omit<SearchPlan, "filters" | "mapping"> & { filters: SearchFilters; mapping: { phrase: string; field: string; value: string; note: string }[] };
export type PlanResult = { ok?: boolean; error?: string; notice?: string; plan?: Plan & { boolean: string; generator: string } };

async function approvedIcp(orgId: string, roleId: string) {
  return db.icp.findFirst({ where: { orgId, roleId, status: "approved" }, include: { items: { where: { status: "approved" }, orderBy: { position: "asc" } } } });
}

/** Deterministic plan from the approved ICP (used when AI is off or fails). */
function planFromIcp(items: { category: string; value: string }[]): Plan {
  const pick = (...cats: string[]) => items.filter((i) => cats.includes(i.category)).map((i) => i.value);
  const filters: SearchFilters = {
    ...EMPTY_FILTERS,
    titles: pick("target_title"),
    adjacent_titles: pick("adjacent_title"),
    skills_required: pick("skill_essential"),
    skills_preferred: pick("skill_preferred"),
    locations: pick("location"),
    seniority: pick("seniority"),
    industries: pick("industry"),
    exclusions: pick("exclusion"),
  };
  const map: Record<string, keyof SearchFilters> = {
    target_title: "titles",
    adjacent_title: "adjacent_titles",
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
    const filters: SearchFilters = { ...EMPTY_FILTERS, ...p.filters };
    return { ok: true, plan: { ...p, filters, boolean: toBoolean(filters), generator: `ai:${ai.provider}:${ai.model}/${SEARCH_ENGINE_VERSION}` } };
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
  keywords: z.array(z.string().max(120)),
  titles: z.array(z.string().max(120)),
  adjacent_titles: z.array(z.string().max(120)),
  skills_required: z.array(z.string().max(120)),
  skills_preferred: z.array(z.string().max(120)),
  locations: z.array(z.string().max(120)),
  seniority: z.array(z.string().max(120)),
  industries: z.array(z.string().max(120)),
  exclusions: z.array(z.string().max(120)),
});

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
  const filters = parseFilters(strategy.filtersJson);
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
  revalidatePath(`/roles/${strategy.roleId}/discover`);
  return { ok: true, message: `${run.resultCount} profiles to review${skipped ? ` · ${skipped} rows skipped (missing name or invalid email/URL)` : ""}${excluded ? ` · ${excluded} matched your approved exclusions` : ""}.`, redirectTo: `/roles/${strategy.roleId}/discover?run=${run.id}#results` };
}

async function ownProfile(orgId: string, id: string) {
  return db.sourcedProfile.findFirst({ where: { id, orgId } });
}

/** Saves a sourced profile to the role's pipeline (at "New"). Never assesses or moves anyone automatically. */
/**
 * Saves a Discover result to the role: the person is marked "Discovered" and added to the
 * shared Shortlist (the recruiter's explicit choice). A person who already applied keeps their
 * "Applied" record — the two are never merged.
 */
export async function saveProfileToRole(profileId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const p = await ownProfile(auth.orgId, profileId);
  if (!p) return { error: "Profile not found." };
  if (p.status === "saved" && p.savedApplicationId) return { ok: true, message: "Already saved to this role." };
  let candidateId: string;
  if (p.source === "talyn") {
    const c = await db.candidate.findFirst({ where: { id: p.sourceRecordId, orgId: auth.orgId }, select: { id: true } });
    if (!c) return { error: "That candidate no longer exists in Talyn." };
    candidateId = c.id;
  } else if (p.duplicateCandidateId && (await db.candidate.count({ where: { id: p.duplicateCandidateId, orgId: auth.orgId } }))) {
    candidateId = p.duplicateCandidateId; // reuse the existing record rather than creating a duplicate
  } else {
    // New person: only source-attributed fields. Contact details only if the source provided them.
    const fields = JSON.parse(p.fieldsJson) as Record<string, { value: string }>;
    const c = await db.candidate.create({
      data: {
        orgId: auth.orgId,
        fullName: p.displayName,
        currentTitle: p.currentTitle,
        currentCompany: p.currentCompany,
        location: p.location,
        email: fields.email?.value ?? null,
        linkedinUrl: fields.linkedin_url?.value ?? null,
        source: p.source === "sample" ? "sample" : `sourced:${p.source}`,
        isSample: p.source === "sample",
        candidateSummary: null,
        fieldOriginsJson: JSON.stringify({ fullName: "sourced", ...Object.fromEntries(Object.keys(fields).flatMap((k) => (PROFILE_KEY[k] ? [[PROFILE_KEY[k], "sourced"]] : []))) }),
      },
    });
    candidateId = c.id;
  }
  const existing = await db.application.findUnique({ where: { candidateId_roleId: { candidateId, roleId: p.roleId } } });
  const label = sourceLabel(p.source);
  const app = await attach(auth, candidateId, p.roleId, { origin: "discovered", detail: `Saved from Discover · ${label}`, sourcedProfileId: p.id });
  const alreadyApplicant = !!existing && existing.origin === "applied";
  if (!existing || (existing.origin === "discovered" && !existing.decision)) {
    await db.application.update({ where: { id: app.id }, data: { decision: "advance", decidedById: auth.userId, decidedByName: auth.userName, decidedAt: new Date(), decisionNote: "Saved from Discover" } });
  }
  await db.sourcedProfile.update({ where: { id: profileId }, data: { status: "saved", savedApplicationId: app.id, reviewedByName: auth.userName, reviewedAt: new Date() } });
  await audit(auth, "sourcing.saved_to_role", { subjectType: "sourcing", subjectId: profileId, candidateId, roleId: p.roleId, applicationId: app.id, meta: { source: p.source, alreadyApplicant } });
  revalidatePath(`/roles/${p.roleId}/discover`);
  revalidatePath(`/roles/${p.roleId}`);
  return {
    ok: true,
    message: alreadyApplicant ? "This person already applied to this role — they stay in Applicants with their application." : "Saved as Discovered and added to the Shortlist. Nothing was assessed or sent.",
  };
}

/** Removes every fictional sample candidate (and their pipeline records) from this workspace. */
export async function clearSampleData(roleId: string): Promise<ActionState> {
  const auth = await requireAuth();
  const n = await db.candidate.deleteMany({ where: { orgId: auth.orgId, isSample: true } });
  await db.sourcedProfile.deleteMany({ where: { orgId: auth.orgId, source: "sample" } });
  await audit(auth, "sample.cleared", { subjectType: "org", subjectId: auth.orgId, meta: { candidates: n.count } });
  revalidatePath(`/roles/${roleId}/discover`);
  revalidatePath(`/roles/${roleId}`);
  return { ok: true, message: `Removed ${n.count} sample candidate${n.count === 1 ? "" : "s"} and all sample results.` };
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
  revalidatePath(`/roles/${p.roleId}/discover`);
  return { ok: true };
}
