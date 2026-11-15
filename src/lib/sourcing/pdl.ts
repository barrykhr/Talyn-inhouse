import "server-only";
import { checkEnv } from "../integrations/env";
import type { ExternalRecord, RawProfile, SourcingConnector } from "./connectors";
import type { SearchFilters } from "./filters";
import { cityOf, defaultSourcingLocation, locationTerms } from "./http";

/**
 * People Data Labs Person Search API (licensed person data; official API, key auth). One credit per
 * record returned, so PDL_MAX_PROFILES caps each search. Contact fields in search results are not
 * stored: emails and phones are looked up only when a recruiter asks (see contacts.ts).
 */

export const PDL_ENV = [
  { name: "PDL_API_KEY", purpose: "People Data Labs API key (dashboard.peopledatalabs.com)", secret: true },
  { name: "PDL_MAX_PROFILES", purpose: "Profiles returned per search (default 50, at most 100); one PDL credit each", optional: true },
];

type Deps = { profileFromRecord: typeof import("./connectors").profileFromRecord; SourceError: typeof import("./connectors").SourceError };

const maxProfiles = () => Math.min(100, Math.max(5, Number(process.env.PDL_MAX_PROFILES) || 50));

type PdlExperience = { title?: { name?: string | null } | null; company?: { name?: string | null } | null; start_date?: string | null; end_date?: string | null; is_primary?: boolean | null; summary?: string | null };
type PdlPerson = {
  id: string;
  full_name?: string | null;
  job_title?: string | null;
  job_company_name?: string | null;
  location_name?: string | null;
  linkedin_url?: string | null;
  skills?: string[] | null;
  summary?: string | null;
  headline?: string | null;
  experience?: PdlExperience[] | null;
  job_last_changed?: string | null;
  job_last_verified?: string | null;
};

const lc = (s: string) => s.trim().toLowerCase();

/** Elasticsearch query: title must match; skills raise the score; location filters. */
export function pdlQuery(filters: SearchFilters, location: string | null) {
  const titles = [...filters.titles, ...filters.adjacent_titles].filter(Boolean);
  const skills = [...filters.skills_required, ...filters.skills_preferred].filter(Boolean).map(lc);
  const must: unknown[] = [];
  if (titles.length) must.push({ bool: { should: titles.map((t) => ({ match_phrase: { job_title: lc(t) } })), minimum_should_match: 1 } });
  else if (skills.length) must.push({ terms: { skills } });
  const terms = locationTerms(location);
  const filter: unknown[] = [];
  if (location && terms) filter.push(terms.includes("india") ? { term: { location_country: "india" } } : { bool: { should: terms.map((t) => ({ match_phrase: { location_name: t } })), minimum_should_match: 1 } });
  return { bool: { must, filter, should: skills.map((s) => ({ term: { skills: s } })) } };
}

export function pdlRecord(p: PdlPerson): ExternalRecord {
  const exp = (p.experience ?? []).slice(0, 15);
  const lines = exp.map((x) => [[x.title?.name, x.company?.name].filter(Boolean).join(" at "), [x.start_date, x.end_date ?? (x.is_primary ? "present" : null)].filter(Boolean).join(" – "), x.summary?.replace(/\s+/g, " ").slice(0, 240)].filter(Boolean).join(" · ").slice(0, 380));
  const title = (s?: string | null) => (s ? s.replace(/\b\w/g, (c) => c.toUpperCase()) : null);
  const ends = exp.map((x) => x.end_date).filter((d): d is string => !!d).sort();
  return {
    id: `pdl:${p.id}`,
    url: p.linkedin_url ? (p.linkedin_url.startsWith("http") ? p.linkedin_url : `https://${p.linkedin_url}`) : null,
    name: title(p.full_name)?.slice(0, 200) || `PDL profile ${p.id.slice(0, 8)}`,
    title: title(p.job_title)?.slice(0, 200) ?? null,
    company: title(p.job_company_name)?.slice(0, 200) ?? null,
    location: title(p.location_name)?.slice(0, 200) ?? null,
    email: null, // looked up only on request
    linkedinUrl: p.linkedin_url ? (p.linkedin_url.startsWith("http") ? p.linkedin_url : `https://${p.linkedin_url}`) : null,
    skills: (p.skills ?? []).filter((s) => s.length <= 100).slice(0, 80),
    summary: [p.headline, p.summary].filter(Boolean).join("\n").slice(0, 8000) || null,
    experience: exp.map((x) => ({ title: x.title?.name ?? null, company: x.company?.name ?? null, start: x.start_date ?? null, end: x.end_date ?? (x.is_primary ? "present" : null), description: x.summary?.slice(0, 2000) ?? null })),
    updatedAt: p.job_last_verified ?? p.job_last_changed ?? null,
    work: { units: lines, unitLabel: "roles", lastActiveAt: exp.some((x) => x.is_primary && !x.end_date) ? new Date().toISOString() : (ends.pop() ?? null), popularity: null, popularityLabel: null },
  };
}

export function makePdlConnector({ profileFromRecord, SourceError }: Deps): SourcingConnector {
  const where = (filters: SearchFilters) => (filters.locations[0] ? cityOf(filters.locations[0]) || defaultSourcingLocation() : defaultSourcingLocation());
  return {
    key: "pdl",
    label: "People Data Labs",
    kind: "external",
    description: "Licensed person profiles with work history and skills, searched by job title, skills and location through People Data Labs' API. Emails and phones on request.",
    configured: () => checkEnv(PDL_ENV).ready,
    setupHint: "Not connected. Create a People Data Labs account (free: 100 records a month without contact data; paid plans include it) and set PDL_API_KEY.",
    syntaxNote: "The job title or an alternative title must match the current title; skills raise the ranking; India filters by country, a city by location. One PDL credit per profile returned (PDL_MAX_PROFILES per search).",
    renderQuery(filters) {
      const loc = where(filters);
      return `title: ${[...filters.titles, ...filters.adjacent_titles].join(" | ") || "(skills only)"} · skills boost: ${filters.skills_required.join(", ") || "none"}${loc ? ` · location: ${loc}` : ""} · up to ${maxProfiles()} profiles`;
    },
    async search({ orgId, filters, years }) {
      if (!filters.titles.length && !filters.skills_required.length) throw new SourceError("People Data Labs needs a job title or at least one required skill.");
      let body: { data?: PdlPerson[]; total?: number; error?: { message?: string } };
      try {
        const res = await fetch("https://api.peopledatalabs.com/v5/person/search", {
          method: "POST",
          headers: { "x-api-key": process.env.PDL_API_KEY ?? "", "content-type": "application/json", accept: "application/json" },
          body: JSON.stringify({ query: pdlQuery(filters, where(filters)), size: maxProfiles(), titlecase: false }),
          signal: AbortSignal.timeout(30_000),
          cache: "no-store",
        });
        if (res.status === 404) return { profiles: [], estimatedTotal: 0, query: this.renderQuery(filters, "") }; // PDL: no records matched
        if (res.status === 401 || res.status === 403) throw new SourceError("People Data Labs rejected the API key or the plan doesn't include Person Search.");
        if (res.status === 402) throw new SourceError("People Data Labs is out of credits.");
        if (res.status === 429) throw new SourceError("People Data Labs' rate limit was reached. Try again in a moment.");
        if (!res.ok) throw new SourceError(`People Data Labs returned an error (HTTP ${res.status}).`);
        body = await res.json();
      } catch (err) {
        if (err instanceof SourceError) throw err;
        throw new SourceError("People Data Labs couldn't be reached. Try again in a moment.");
      }
      const profiles: RawProfile[] = [];
      for (const p of body.data ?? []) {
        if (!p?.id) continue;
        const r = await profileFromRecord(orgId, pdlRecord(p), filters, "People Data Labs", { relevanceGate: false, years });
        if (r) profiles.push(r);
      }
      return { profiles, estimatedTotal: body.total ?? null, query: this.renderQuery(filters, "") };
    },
  };
}
