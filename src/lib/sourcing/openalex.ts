import "server-only";
import { checkEnv } from "../integrations/env";
import type { ExternalRecord, RawProfile, SourcingConnector } from "./connectors";
import type { SearchFilters } from "./filters";
import { getJson, isLanguageName } from "./http";

/**
 * OpenAlex sourcing connector — research roles (open scholarly data, official API, key required
 * since February 2026). Searches recent papers on the role's topics whose authors are affiliated
 * with institutions in one country, then groups the papers by author. The paper lines are the
 * quoted evidence. OpenAlex holds no contact details, so none are stored.
 */

export const OPENALEX_ENV = [
  { name: "OPENALEX_API_KEY", purpose: "OpenAlex API key (free at openalex.org/settings/api)", secret: true },
  { name: "OPENALEX_COUNTRY", purpose: 'Two-letter country of the authors\' institutions; default "IN"', optional: true },
];

type Deps = { profileFromRecord: typeof import("./connectors").profileFromRecord; SourceError: typeof import("./connectors").SourceError };

type OaWork = {
  id: string;
  display_name: string | null;
  publication_year: number | null;
  publication_date: string | null;
  cited_by_count: number | null;
  primary_location?: { source?: { display_name?: string | null } | null } | null;
  authorships?: { author?: { id?: string | null; display_name?: string | null; orcid?: string | null } | null; institutions?: { display_name?: string | null; country_code?: string | null }[] | null }[] | null;
};
type OaAuthor = { id: string; name: string; orcid: string | null; institutions: Map<string, number>; works: OaWork[]; citations: number };

const MAX_AUTHORS = 30;
const COUNTRY_NAME: Record<string, string> = { IN: "India", US: "United States", GB: "United Kingdom", SG: "Singapore", AE: "United Arab Emirates", DE: "Germany", CA: "Canada", AU: "Australia" };

export const openAlexCountry = () => (process.env.OPENALEX_COUNTRY?.trim() || "IN").toUpperCase().slice(0, 2);

/** The role's topics as an OpenAlex full-text search (required skills and the recruiter's query terms). */
export function openAlexTerms(filters: SearchFilters): string[] {
  // Every extra word narrows a paper search, and language names ("Python") add nothing: keep two topics.
  return Array.from(new Set([...filters.keywords, ...filters.skills_required].map((s) => s.trim()).filter((s) => s.length > 1 && !isLanguageName(s)))).slice(0, 2);
}

/** Groups papers by author, keeping only authors affiliated in the chosen country on that paper. */
export function groupByAuthor(works: OaWork[], country: string): OaAuthor[] {
  const authors = new Map<string, OaAuthor>();
  for (const w of works) {
    for (const a of w.authorships ?? []) {
      const id = a.author?.id;
      const name = a.author?.display_name?.trim();
      const local = (a.institutions ?? []).filter((i) => i.country_code?.toUpperCase() === country);
      if (!id || !name || !local.length) continue;
      const cur = authors.get(id) ?? { id, name, orcid: a.author?.orcid ?? null, institutions: new Map<string, number>(), works: [], citations: 0 };
      for (const i of local) if (i.display_name) cur.institutions.set(i.display_name, (cur.institutions.get(i.display_name) ?? 0) + 1);
      cur.works.push(w);
      cur.citations += w.cited_by_count ?? 0;
      authors.set(id, cur);
    }
  }
  // Most matching papers first, then citations.
  return [...authors.values()].sort((x, y) => y.works.length - x.works.length || y.citations - x.citations).slice(0, MAX_AUTHORS);
}

export function openAlexRecord(a: OaAuthor, country: string): ExternalRecord {
  const institution = [...a.institutions.entries()].sort((x, y) => y[1] - x[1])[0]?.[0] ?? null;
  const works = [...a.works].sort((x, y) => (y.publication_date ?? "").localeCompare(x.publication_date ?? "")).slice(0, 12);
  const lines = works.map((w) => [`"${(w.display_name ?? "Untitled").slice(0, 220)}"`, w.primary_location?.source?.display_name ?? null, w.publication_year ? String(w.publication_year) : null, w.cited_by_count ? `cited by ${w.cited_by_count}` : null].filter(Boolean).join(" · "));
  const summary = [`Papers matching this search (${a.works.length}), most recent first:`, ...lines, a.orcid ? `ORCID: ${a.orcid}` : null].filter(Boolean).join("\n").slice(0, 20000);
  return {
    id: `openalex:${a.id.split("/").pop()}`,
    url: /^https?:\/\//.test(a.id) ? a.id : `https://openalex.org/${a.id}`,
    name: a.name.slice(0, 200),
    title: null, // not held by OpenAlex; never guessed
    company: institution?.slice(0, 200) ?? null,
    location: `${COUNTRY_NAME[country] ?? country} (institution's country)`,
    email: null,
    linkedinUrl: null,
    skills: null,
    summary,
    experience: null,
    updatedAt: works[0]?.publication_date ?? null,
    work: { units: lines, unitLabel: "papers", lastActiveAt: works[0]?.publication_date ?? null, popularity: a.citations, popularityLabel: "citations" },
  };
}

export function makeOpenAlexConnector({ profileFromRecord, SourceError }: Deps): SourcingConnector {
  return {
    key: "openalex",
    label: "OpenAlex (research papers)",
    kind: "external",
    description: "Authors of recent research papers on the role's topics, from OpenAlex's open scholarly data. Best for research and applied-science roles.",
    configured: () => checkEnv(OPENALEX_ENV).ready,
    setupHint: "Not connected. Get a free API key at openalex.org/settings/api and set OPENALEX_API_KEY. Optionally set OPENALEX_COUNTRY (default IN).",
    syntaxNote: "The first two required skills or search terms (programming languages skipped) are sent as one full-text search over paper titles and abstracts from the last three years; authors are kept only when their institution on that paper is in the configured country. Titles, locations and Boolean operators are not interpreted.",
    renderQuery(filters) {
      const terms = openAlexTerms(filters);
      return terms.length ? `papers: ${terms.join(" ")} · institutions in ${openAlexCountry()} · last 3 years` : "No searchable terms";
    },
    async search({ orgId, filters, years }) {
      const terms = openAlexTerms(filters);
      if (!terms.length) throw new SourceError("OpenAlex needs at least one required skill or search term.");
      const country = openAlexCountry();
      const since = new Date(Date.now() - 3 * 365 * 86400000).toISOString().slice(0, 10);
      const qs = new URLSearchParams({
        search: terms.join(" "),
        filter: `authorships.institutions.country_code:${country},from_publication_date:${since}`,
        per_page: "100",
        select: "id,display_name,publication_year,publication_date,cited_by_count,primary_location,authorships",
        api_key: process.env.OPENALEX_API_KEY ?? "",
      });
      const body = await getJson<{ meta?: { count?: number }; results?: OaWork[] }>("OpenAlex", `https://api.openalex.org/works?${qs}`, {}, SourceError);
      const authors = groupByAuthor(body?.results ?? [], country);
      const profiles: RawProfile[] = [];
      for (const a of authors) {
        // The source matched on titles and abstracts, so no second relevance gate on the title lines.
        const p = await profileFromRecord(orgId, openAlexRecord(a, country), filters, "OpenAlex", { relevanceGate: false, years });
        if (p) profiles.push(p);
      }
      return { profiles, estimatedTotal: null, query: this.renderQuery(filters, "") };
    },
  };
}
