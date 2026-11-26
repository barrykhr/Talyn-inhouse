"use server";

import { revalidatePath } from "next/cache";
import { AiRequestError, AiUnavailableError, COMPANY_EVENTS_VERSION, aiStatus, companyEventsWithAi } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { companyKey } from "@/lib/calls/core";
import { db } from "@/lib/db";
import { keepSeenUrls } from "@/lib/discovery/target-companies";
import { logError } from "@/lib/log";
import type { CompanyEvent } from "@/lib/timing";
import type { ActionState } from "./form";

const TYPES = new Set<CompanyEvent["type"]>(["layoffs", "restructuring", "acquisition", "leadership_change", "funding", "hiring_freeze", "office_closure", "other"]);

/**
 * Looks up public news about a candidate's current company (web search, cited). Only events whose
 * source page the search actually retrieved are kept. Cached for the workspace.
 */
export async function checkCompanyNews(candidateId: string): Promise<ActionState> {
  const auth = await requireAuth();
  if (!aiStatus().configured) return { error: "AI is off for this workspace." };
  const c = await db.candidate.findFirst({ where: { id: candidateId, orgId: auth.orgId }, select: { id: true, currentCompany: true, extracted: { where: { field: "work_history", status: { not: "rejected" } }, select: { valueJson: true, editedValueJson: true } } } });
  if (!c) return { error: "Candidate not found." };
  const fromCv = c.extracted.map((f) => JSON.parse(f.editedValueJson ?? f.valueJson) as { employer: string; end: string }).find((j) => /present|current|now/i.test(j.end))?.employer;
  const name = (c.currentCompany || fromCv || "").trim();
  if (!name) return { error: "There's no current employer on file to look up." };
  return lookup(auth.orgId, auth, name, `/candidates/${candidateId}`);
}

async function lookup(orgId: string, auth: Awaited<ReturnType<typeof requireAuth>>, name: string, path: string): Promise<ActionState> {
  const ai = aiStatus();
  try {
    const r = await companyEventsWithAi({ name, today: new Date().toISOString().slice(0, 10) });
    if (!r.webSearch) return { error: "Web search isn't available for this AI account, so company news can't be checked with sources." };
    const seen = new Set(r.urls);
    const events: CompanyEvent[] = r.output.events
      .filter((e) => TYPES.has(e.type) && /^\d{4}-\d{2}$/.test(e.date.trim()))
      .map((e) => ({ type: e.type, date: e.date.trim(), headline: e.headline.trim().slice(0, 200), url: keepSeenUrls([e.source_url], seen)[0] ?? "" }))
      .filter((e) => e.url && e.headline)
      .slice(0, 8);
    const key = companyKey(name);
    await db.companyEvents.upsert({
      where: { orgId_companyKey: { orgId, companyKey: key } },
      create: { orgId, companyKey: key, name, eventsJson: JSON.stringify(events), webSearch: true, model: `ai:${ai.provider}:${ai.model}/${COMPANY_EVENTS_VERSION}` },
      update: { name, eventsJson: JSON.stringify(events), webSearch: true, model: `ai:${ai.provider}:${ai.model}/${COMPANY_EVENTS_VERSION}`, checkedAt: new Date() },
    });
    await audit(auth, "timing.company_news_checked", { subjectType: "company", subjectId: key, meta: { events: events.length } });
    revalidatePath(path);
    return { ok: true, message: events.length ? `Found ${events.length} recent event${events.length === 1 ? "" : "s"} at ${name}, each with its source.` : `No notable news found for ${name} in the last 12 months.` };
  } catch (err) {
    if (!(err instanceof AiRequestError || err instanceof AiUnavailableError)) logError("timing.company_news_failed", err);
    return { error: err instanceof AiRequestError ? err.message : "Couldn't check company news. Try again." };
  }
}

/** Same lookup for a Discover result's current company. */
export async function checkCompanyNewsForProfile(profileId: string): Promise<ActionState> {
  const auth = await requireAuth();
  if (!aiStatus().configured) return { error: "AI is off for this workspace." };
  const p = await db.sourcedProfile.findFirst({ where: { id: profileId, orgId: auth.orgId }, select: { roleId: true, currentCompany: true } });
  if (!p?.currentCompany?.trim()) return { error: "No current company on this profile." };
  return lookup(auth.orgId, auth, p.currentCompany.trim(), `/roles/${p.roleId}/discover`);
}
