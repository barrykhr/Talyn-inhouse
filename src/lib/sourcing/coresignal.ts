import "server-only";
import { checkEnv } from "../integrations/env";
import type { ExternalRecord, RawProfile, SourcingConnector } from "./connectors";
import type { SearchFilters } from "./filters";
import { cityOf, defaultSourcingLocation, getJson, inBatches, linkedinFrom, locationTerms } from "./http";

/**
 * Coresignal Multi-source Employee API (licensed professional profiles; official API, key auth).
 * Search returns record IDs only; each full profile is a separate "collect" call that uses credits,
 * so CORESIGNAL_MAX_PROFILES caps how many are read per search. Work emails come from the separate
 * Contact Enrichment API, only when a recruiter asks for one (see contacts.ts).
 */

export const CORESIGNAL_ENV = [
  { name: "CORESIGNAL_API_KEY", purpose: "Coresignal API key (dashboard.coresignal.com)", secret: true },
  { name: "CORESIGNAL_MAX_PROFILES", purpose: "Profiles collected per search (default 50, at most 200); each uses Coresignal credits", optional: true },
];

type Deps = { profileFromRecord: typeof import("./connectors").profileFromRecord; SourceError: typeof import("./connectors").SourceError };

const API = "https://api.coresignal.com/cdapi/v2/employee_multi_source";
const maxProfiles = () => Math.min(200, Math.max(5, Number(process.env.CORESIGNAL_MAX_PROFILES) || 50));

type CsExperience = { position_title?: string | null; company_name?: string | null; date_from?: string | null; date_to?: string | null; description?: string | null; active_experience?: number | null };
type CsEmployee = {
  id: number;
  full_name?: string | null;
  headline?: string | null;
  summary?: string | null;
  active_experience_title?: string | null;
  location_full?: string | null;
  location_country?: string | null;
  professional_network_url?: string | null;
  inferred_skills?: string[] | string | null;
  experience?: CsExperience[] | null;
  is_working?: number | null;
  updated_at?: string | null;
  last_changed_at?: string | null;
};

/** Elasticsearch query: a title or alternative title must match; skills raise the score; location filters. */
export function coresignalQuery(filters: SearchFilters, location: string | null) {
  const titles = [...filters.titles, ...filters.adjacent_titles].filter(Boolean);
  const skills = [...filters.skills_required, ...filters.skills_preferred, ...filters.keywords].filter(Boolean);
  const must: unknown[] = [];
  if (titles.length)
    must.push({ bool: { should: titles.flatMap((t) => [{ match_phrase: { active_experience_title: t } }, { match_phrase: { headline: t } }]), minimum_should_match: 1 } });
  else if (skills.length) must.push({ bool: { should: skills.map((s) => ({ match_phrase: { inferred_skills: s } })), minimum_should_match: 1 } });
  const filter: unknown[] = [];
  const terms = locationTerms(location);
  if (location && terms) {
    filter.push(
      terms.includes("india")
        ? { term: { location_country: "India" } }
        : { bool: { should: terms.map((t) => ({ match_phrase: { location_full: t } })), minimum_should_match: 1 } },
    );
  }
  return { query: { bool: { must, filter, should: skills.map((s) => ({ match_phrase: { inferred_skills: { query: s, boost: 2 } } })) } } };
}

export function coresignalRecord(e: CsEmployee): ExternalRecord {
  const exp = (e.experience ?? []).slice(0, 15);
  const current = exp.find((x) => x.active_experience === 1) ?? exp[0];
  const skills = Array.isArray(e.inferred_skills) ? e.inferred_skills : typeof e.inferred_skills === "string" ? e.inferred_skills.split(/,\s*/) : [];
  const roleLines = exp.map((x) =>
    [[x.position_title, x.company_name].filter(Boolean).join(" at "), [x.date_from, x.date_to ?? (x.active_experience ? "present" : null)].filter(Boolean).join(" – "), x.description?.replace(/\s+/g, " ").slice(0, 240)]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 380),
  );
  const ym = (v?: string | null) => v?.match(/\d{4}(-\d{2})?/)?.[0] ?? null;
  return {
    id: `coresignal:${e.id}`,
    url: e.professional_network_url && /^https?:\/\//.test(e.professional_network_url) ? e.professional_network_url : null,
    name: (e.full_name?.trim() || `Coresignal profile ${e.id}`).slice(0, 200),
    title: (e.active_experience_title || current?.position_title || e.headline)?.trim().slice(0, 200) || null,
    company: current?.company_name?.trim().slice(0, 200) || null,
    location: e.location_full?.trim().slice(0, 200) || null,
    email: null, // only through Contact Enrichment, when a recruiter asks
    linkedinUrl: linkedinFrom(e.professional_network_url),
    skills: skills.map((s) => s.trim()).filter((s) => s && s.length <= 100).slice(0, 80),
    summary: [e.headline?.trim(), e.summary?.trim()].filter(Boolean).join("\n").slice(0, 8000) || null,
    experience: exp.map((x) => ({ title: x.position_title ?? null, company: x.company_name ?? null, start: ym(x.date_from), end: x.active_experience ? "present" : ym(x.date_to), description: x.description?.slice(0, 2000) ?? null })),
    updatedAt: e.last_changed_at ?? e.updated_at ?? null,
    work: { units: roleLines, unitLabel: "roles", lastActiveAt: e.is_working ? new Date().toISOString() : (exp.map((x) => ym(x.date_to)).filter(Boolean).sort().pop() ?? null), popularity: null, popularityLabel: null },
  };
}

export function makeCoresignalConnector({ profileFromRecord, SourceError }: Deps): SourcingConnector {
  const headers = () => ({ apikey: process.env.CORESIGNAL_API_KEY ?? "" });
  const where = (filters: SearchFilters) => (filters.locations[0] ? cityOf(filters.locations[0]) || defaultSourcingLocation() : defaultSourcingLocation());
  return {
    key: "coresignal",
    label: "Coresignal",
    kind: "external",
    description: "Licensed professional profiles with work history and skills, searched by job title, skills and location through Coresignal's API. Work emails on request.",
    configured: () => checkEnv(CORESIGNAL_ENV).ready,
    setupHint: "Not connected. Create a Coresignal account (7-day trial with 2,000 credits), copy the API key and set CORESIGNAL_API_KEY. Ask Coresignal to enable the Contact Enrichment API for work emails.",
    syntaxNote: "The job title or an alternative title must match the current title or headline; skills raise the ranking; India filters by country, a city by the profile's location. Each profile read uses Coresignal credits (CORESIGNAL_MAX_PROFILES per search).",
    renderQuery(filters) {
      const loc = where(filters);
      return `title: ${[...filters.titles, ...filters.adjacent_titles].join(" | ") || "(skills only)"} · skills boost: ${filters.skills_required.join(", ") || "none"}${loc ? ` · location: ${loc}` : ""} · up to ${maxProfiles()} profiles`;
    },
    async search({ orgId, filters, years }) {
      if (!filters.titles.length && !filters.skills_required.length) throw new SourceError("Coresignal needs a job title or at least one required skill.");
      let ids: unknown;
      try {
        const res = await fetch(`${API}/search/es_dsl`, {
          method: "POST",
          headers: { ...headers(), accept: "application/json", "content-type": "application/json" },
          body: JSON.stringify(coresignalQuery(filters, where(filters))),
          signal: AbortSignal.timeout(30_000),
          cache: "no-store",
        });
        if (res.status === 401 || res.status === 403) throw new SourceError("Coresignal rejected the API key or the plan doesn't include this API.");
        if (res.status === 402) throw new SourceError("Coresignal is out of credits.");
        if (res.status === 429) throw new SourceError("Coresignal's rate limit was reached. Try again in a moment.");
        if (!res.ok) throw new SourceError(`Coresignal returned an error (HTTP ${res.status}).`);
        ids = await res.json();
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError("Coresignal couldn't be reached. Try again in a moment.");
      }
      const list = (Array.isArray(ids) ? ids : []).map((x) => Number(x)).filter((x) => Number.isFinite(x)).slice(0, maxProfiles());
      const profiles = await inBatches(list, 5, async (id): Promise<RawProfile | null> => {
        const e = await getJson<CsEmployee>("Coresignal", `${API}/collect/${id}`, headers(), SourceError, { allow404: true });
        return e ? profileFromRecord(orgId, coresignalRecord(e), filters, "Coresignal", { relevanceGate: false, years }) : null;
      });
      return { profiles: profiles.filter((p): p is RawProfile => !!p), estimatedTotal: Array.isArray(ids) ? ids.length : null, query: this.renderQuery(filters, "") };
    },
  };
}
