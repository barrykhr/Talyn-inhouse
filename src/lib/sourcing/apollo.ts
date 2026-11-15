import "server-only";
import { checkEnv } from "../integrations/env";
import type { ExternalRecord, RawProfile, SourcingConnector } from "./connectors";
import type { SearchFilters } from "./filters";
import { cityOf, defaultSourcingLocation } from "./http";

/**
 * Apollo.io People API Search (official API, key auth). Searching uses no credits but returns only
 * first name, a partly hidden last name, job title and employer: no skills or location. The full
 * name, email and LinkedIn come from People Enrichment, only when a recruiter asks (see contacts.ts).
 * Apollo is built for sales prospecting: confirm your Apollo terms cover recruiting.
 */

export const APOLLO_ENV = [
  { name: "APOLLO_API_KEY", purpose: "Apollo.io API key (Settings → Integrations → API)", secret: true },
  { name: "APOLLO_MAX_PROFILES", purpose: "People returned per search (default 100, at most 300); searching uses no Apollo credits", optional: true },
];

type Deps = { profileFromRecord: typeof import("./connectors").profileFromRecord; SourceError: typeof import("./connectors").SourceError };

const maxProfiles = () => Math.min(300, Math.max(10, Number(process.env.APOLLO_MAX_PROFILES) || 100));

type ApolloPerson = { id: string; first_name?: string | null; last_name_obfuscated?: string | null; title?: string | null; last_refreshed_at?: string | null; has_email?: boolean; organization?: { name?: string | null } | null };

export function apolloParams(filters: SearchFilters, location: string | null, page: number, perPage: number) {
  const qs = new URLSearchParams();
  for (const t of [...filters.titles, ...filters.adjacent_titles].filter(Boolean).slice(0, 20)) qs.append("person_titles[]", t);
  if (location) qs.append("person_locations[]", location);
  qs.set("per_page", String(perPage));
  qs.set("page", String(page));
  return qs;
}

export function apolloRecord(p: ApolloPerson): ExternalRecord {
  const name = [p.first_name, p.last_name_obfuscated].filter(Boolean).join(" ").trim();
  return {
    id: `apollo:${p.id}`,
    url: `https://app.apollo.io/#/people/${encodeURIComponent(p.id)}`,
    name: (name || "Apollo profile").slice(0, 200),
    title: p.title?.trim().slice(0, 200) || null,
    company: p.organization?.name?.trim().slice(0, 200) || null,
    location: null, // not returned by Apollo search; shown after a contact lookup
    email: null,
    linkedinUrl: null,
    skills: null,
    summary: p.has_email ? "Apollo holds a verified email for this person (look it up to see it)." : null,
    experience: null,
    updatedAt: p.last_refreshed_at ?? null,
  };
}

export function makeApolloConnector({ profileFromRecord, SourceError }: Deps): SourcingConnector {
  const where = (filters: SearchFilters) => (filters.locations[0] ? cityOf(filters.locations[0]) || defaultSourcingLocation() : defaultSourcingLocation());
  return {
    key: "apollo",
    label: "Apollo.io",
    kind: "external",
    description: "People by job title and location from Apollo's database. Search is free; full name and email come from a lookup on request. No skills data, so these results rely on job title.",
    configured: () => checkEnv(APOLLO_ENV).ready,
    setupHint: "Not connected. Create an Apollo API key (Settings → Integrations → API) and set APOLLO_API_KEY. Confirm your Apollo terms cover recruiting.",
    syntaxNote: "Matches the job title and alternative titles (similar titles included) and where the person lives. Apollo returns no skills, so skill evidence comes only after you save someone and add their CV.",
    renderQuery(filters) {
      const loc = where(filters);
      return `titles: ${[...filters.titles, ...filters.adjacent_titles].join(" | ") || "none"}${loc ? ` · lives in: ${loc}` : ""} · up to ${maxProfiles()} people`;
    },
    async search({ orgId, filters, years }) {
      if (!filters.titles.length && !filters.adjacent_titles.length) throw new SourceError("Apollo needs a job title.");
      const want = maxProfiles();
      const people: ApolloPerson[] = [];
      let total: number | null = null;
      for (let page = 1; people.length < want && page <= 5; page++) {
        let body: { people?: ApolloPerson[]; total_entries?: number };
        try {
          const res = await fetch(`https://api.apollo.io/api/v1/mixed_people/api_search?${apolloParams(filters, where(filters), page, Math.min(100, want))}`, {
            method: "POST",
            headers: { "x-api-key": process.env.APOLLO_API_KEY ?? "", "content-type": "application/json", accept: "application/json", "cache-control": "no-cache" },
            signal: AbortSignal.timeout(30_000),
            cache: "no-store",
          });
          if (res.status === 401 || res.status === 403) throw new SourceError("Apollo rejected the API key, or this key can't use People Search.");
          if (res.status === 422) throw new SourceError("Apollo couldn't run this search. Use fewer job titles.");
          if (res.status === 429) throw new SourceError("Apollo's rate limit was reached. Try again in a minute.");
          if (!res.ok) throw new SourceError(`Apollo returned an error (HTTP ${res.status}).`);
          body = await res.json();
        } catch (err) {
          if (err instanceof SourceError) throw err;
          throw new SourceError("Apollo couldn't be reached. Try again in a moment.");
        }
        total ??= body.total_entries ?? null;
        people.push(...(body.people ?? []));
        if ((body.people ?? []).length < Math.min(100, want)) break;
      }
      const profiles: RawProfile[] = [];
      for (const p of people.slice(0, want)) {
        if (!p?.id) continue;
        // Apollo already matched the title, so no second relevance gate on the shortened record.
        const r = await profileFromRecord(orgId, apolloRecord(p), filters, "Apollo.io", { relevanceGate: false, years });
        if (r) profiles.push(r);
      }
      return { profiles, estimatedTotal: total, query: this.renderQuery(filters, "") };
    },
  };
}
