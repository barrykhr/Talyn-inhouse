import "server-only";
import { checkEnv } from "../integrations/env";
import type { ExternalRecord, RawProfile, SourcingConnector } from "./connectors";
import type { SearchFilters } from "./filters";
import { cityOf, locationMatches, locationSearchTerms, locationTerms } from "./http";

/**
 * GitHub sourcing connector (official REST API, token auth — no scraping, no logins).
 *
 * What it does: turns the reviewed Discover fields into two GitHub searches (people by
 * language + location, and repositories by topic), then reads each person's public profile and
 * their most recently pushed repositories. The repository lines become the quoted evidence.
 *
 * What it deliberately does not do: it never stores a GitHub email address. GitHub's Acceptable
 * Use Policies do not allow using information from the service to send unsolicited email, so
 * contact details must come from somewhere the person published them for contact, from your own
 * records, or from a licensed contact-data provider.
 *
 * Wiring (src/lib/sourcing/connectors.ts):
 *   import { makeGithubConnector } from "./github";
 *   const github = makeGithubConnector({ profileFromRecord, SourceError });
 *   export const CONNECTORS = [talynRediscovery, externalProvider, github, sampleData];
 * Dependencies are passed in so this file has no runtime import of connectors.ts (no cycle).
 */

export const GITHUB_ENV = [
  { name: "GITHUB_TOKEN", purpose: "GitHub personal access token (public data only — no scopes needed)", secret: true },
  { name: "GITHUB_MAX_PROFILES", purpose: "Profiles read per GitHub search (default 200, at most 300); each costs 2 of the token's 5,000 hourly requests", optional: true },
  { name: "SOURCING_DEFAULT_LOCATION", purpose: 'Location used when the role has none, e.g. "India" (shared with Stack Overflow)', optional: true },
];

type Deps = {
  profileFromRecord: typeof import("./connectors").profileFromRecord;
  SourceError: typeof import("./connectors").SourceError;
};

const API = "https://api.github.com";
/** Profiles read per search (2 API calls each). GITHUB_MAX_PROFILES overrides it, up to 300. */
const maxPeople = () => Math.min(300, Math.max(10, Number(process.env.GITHUB_MAX_PROFILES) || 200));
const REPOS_PER_PERSON = 12;
const CONCURRENCY = 10;
const PAGE = 100; // GitHub search returns at most 100 per page and 1,000 per query

/** Skills that GitHub understands as a `language:` qualifier. Anything else is a topic keyword. */
export const LANGUAGE: Record<string, string> = {
  python: "Python",
  typescript: "TypeScript",
  javascript: "JavaScript",
  java: "Java",
  go: "Go",
  golang: "Go",
  scala: "Scala",
  rust: "Rust",
  kotlin: "Kotlin",
  swift: "Swift",
  ruby: "Ruby",
  php: "PHP",
  dart: "Dart",
  r: "R",
  "c++": "C++",
  "c#": "C#",
  c: "C",
  elixir: "Elixir",
  shell: "Shell",
};

type GhUser = { login: string; name: string | null; company: string | null; blog: string | null; location: string | null; bio: string | null; html_url: string; updated_at: string; type: string };
type GhRepo = { name: string; description: string | null; language: string | null; topics?: string[]; stargazers_count: number; fork: boolean; pushed_at: string | null; html_url: string };

const quoteIfNeeded = (t: string) => (/\s/.test(t) ? `"${t.replace(/"/g, "")}"` : t);

/** Splits the reviewed skills into GitHub languages and free-text topic terms. */
export function planGithubSearch(filters: SearchFilters, defaultLocation: string | null) {
  const skills = [...filters.skills_required, ...filters.skills_preferred, ...filters.keywords];
  const languages = Array.from(new Set(skills.map((s) => LANGUAGE[s.trim().toLowerCase()]).filter((x): x is string => !!x))).slice(0, 2);
  const topics = Array.from(new Set(filters.skills_required.concat(filters.keywords).filter((s) => !LANGUAGE[s.trim().toLowerCase()]).map((s) => s.trim()).filter((s) => s.length > 1))).slice(0, 2);
  const location = filters.locations[0] ? cityOf(filters.locations[0]) || defaultLocation : defaultLocation;
  const since = new Date(Date.now() - 365 * 86400000).toISOString().slice(0, 10);

  // GitHub combines several location: filters with OR, so one query per language covers every
  // place: "India" becomes the country plus every Indian city and state people write on profiles.
  const places = location ? locationSearchTerms(location) : [];
  const where = places.map((p) => `location:${quoteIfNeeded(p)}`).join(" ");
  const userQueries = (languages.length ? languages : [null]).map((lang) => ["type:user", lang ? `language:${quoteIfNeeded(lang)}` : null, "repos:>3", where || null].filter(Boolean).join(" "));
  // Without a language or a location a people search would be "everyone on GitHub": skip it.
  const peopleQueries = languages.length || location ? userQueries : [];
  const repoQuery = topics.length ? [...topics.map(quoteIfNeeded), "in:name,description,topics", languages[0] ? `language:${quoteIfNeeded(languages[0])}` : null, `pushed:>${since}`, "fork:false"].filter(Boolean).join(" ") : null;
  return { languages, topics, location, places, peopleQueries, repoQuery };
}

function linkedinFrom(blog: string | null): string | null {
  const m = blog?.match(/(?:https?:\/\/)?(?:[a-z]{2,3}\.)?linkedin\.com\/in\/[A-Za-z0-9\-_%]+/i);
  if (!m) return null;
  return m[0].startsWith("http") ? m[0] : `https://${m[0]}`;
}

function websiteFrom(blog: string | null): string | null {
  const b = blog?.trim();
  if (!b || /linkedin\.com/i.test(b)) return null;
  return /^https?:\/\//i.test(b) ? b : `https://${b}`;
}

/** One GitHub person + their repositories → the record shape every Talyn source returns. */
export function githubRecord(user: GhUser, repos: GhRepo[]): ExternalRecord {
  const own = repos.filter((r) => !r.fork).slice(0, REPOS_PER_PERSON);
  const skills = Array.from(new Set(own.flatMap((r) => [r.language, ...(r.topics ?? [])]).filter((x): x is string => !!x && x.length <= 100))).slice(0, 60);
  const repoLines = own.map((r) =>
    [`${r.name}${r.description ? ` — ${r.description}` : ""}`, r.language, r.topics?.length ? `topics: ${r.topics.slice(0, 8).join(", ")}` : null, r.stargazers_count ? `★${r.stargazers_count}` : null, r.pushed_at ? `last pushed ${r.pushed_at.slice(0, 7)}` : null]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 300),
  );
  const website = websiteFrom(user.blog);
  const summary = [user.bio?.trim(), website ? `Website: ${website}` : null, repoLines.length ? "Public repositories (most recently pushed first):" : null, ...repoLines].filter(Boolean).join("\n").slice(0, 20000);
  const pushed = own.map((r) => r.pushed_at).filter((d): d is string => !!d).sort();
  return {
    id: `github:${user.login}`,
    url: user.html_url,
    name: (user.name?.trim() || user.login).slice(0, 200),
    title: null, // GitHub has no job title; never guessed
    company: user.company?.replace(/^@/, "").trim().slice(0, 200) || null,
    location: user.location?.trim().slice(0, 200) || null,
    email: null, // deliberately not taken from GitHub — see the note at the top of this file
    linkedinUrl: linkedinFrom(user.blog),
    skills,
    summary: summary || null,
    experience: null,
    updatedAt: pushed[pushed.length - 1] ?? user.updated_at,
    work: { units: repoLines, unitLabel: "repositories", lastActiveAt: pushed[pushed.length - 1] ?? null, popularity: own.reduce((n, r) => n + (r.stargazers_count || 0), 0), popularityLabel: "stars" },
  };
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

export function makeGithubConnector({ profileFromRecord, SourceError }: Deps): SourcingConnector {
  async function gh<T>(path: string): Promise<T> {
    let res: Response;
    try {
      res = await fetch(`${API}${path}`, {
        headers: { accept: "application/vnd.github+json", "x-github-api-version": "2022-11-28", authorization: `Bearer ${process.env.GITHUB_TOKEN}`, "user-agent": "talyn-sourcing" },
        signal: AbortSignal.timeout(20_000),
        cache: "no-store",
      });
    } catch {
      throw new SourceError("GitHub couldn't be reached. Try again in a moment.");
    }
    if (res.status === 401) throw new SourceError("GitHub rejected the token. Check GITHUB_TOKEN.");
    // GitHub answers 403 both for rate limits and for other refusals: tell them apart.
    const limited = res.status === 429 || (res.status === 403 && (res.headers.get("x-ratelimit-remaining") === "0" || res.headers.has("retry-after")));
    if (limited) throw new SourceError("GitHub's rate limit was reached. Try again in a few minutes.");
    if (res.status === 403) throw new SourceError("GitHub refused the request (HTTP 403). Check the token's access.");
    if (res.status === 422) throw new SourceError("GitHub couldn't run this search. Simplify the skills or location and try again.");
    if (!res.ok) throw new SourceError(`GitHub returned an error (HTTP ${res.status}).`);
    return (await res.json()) as T;
  }

  const defaultLocation = () => process.env.GITHUB_DEFAULT_LOCATION?.trim() || process.env.SOURCING_DEFAULT_LOCATION?.trim() || null;

  return {
    key: "github",
    label: "GitHub",
    kind: "external",
    description: "Public GitHub profiles and repositories, read through GitHub's official API. Evidence is quoted from repository names, descriptions and topics.",
    configured: () => checkEnv(GITHUB_ENV).ready,
    setupHint: "Not connected. Create a GitHub personal access token (no scopes needed for public data) and set GITHUB_TOKEN. Optionally set SOURCING_DEFAULT_LOCATION, e.g. India.",
    syntaxNote: "Programming languages become GitHub language filters; other required skills are searched in repository names, descriptions and topics; the location is matched against each person's public profile; India covers the country and its major cities (Bangalore/Bengaluru, Hyderabad, Pune, Mumbai, Delhi NCR, Chennai and more). Boolean operators are not interpreted.",
    renderQuery(filters) {
      const plan = planGithubSearch(filters, defaultLocation());
      const short = (q: string) => (plan.places.length > 3 ? `${q.replace(/ location:.*$/, "")} · location: ${plan.location} (${plan.places.length} place names)` : q);
      return [...plan.peopleQueries.map((q) => `people: ${short(q)}`), plan.repoQuery ? `repositories: ${plan.repoQuery}` : null].filter(Boolean).join(" · ") || "No searchable terms";
    },
    async search({ orgId, filters, years }) {
      const plan = planGithubSearch(filters, defaultLocation());
      if (!plan.peopleQueries.length && !plan.repoQuery) throw new SourceError("GitHub needs at least one skill or a location to search.");

      const cap = maxPeople();
      // 1. People whose public profile matches language + location (GitHub applies the location).
      //    Pages of 100, shared across the queries, until there are enough candidates.
      const perQuery = Math.ceil(cap / Math.max(1, plan.peopleQueries.length));
      const fromPeople = new Set<string>();
      let estimatedTotal: number | null = null;
      for (const q of plan.peopleQueries) {
        let got = 0;
        for (let page = 1; got < perQuery && page <= 10; page++) {
          const r = await gh<{ total_count: number; items: { login: string; type: string }[] }>(`/search/users?q=${encodeURIComponent(q)}&per_page=${PAGE}&page=${page}`);
          if (page === 1) estimatedTotal = (estimatedTotal ?? 0) + r.total_count;
          for (const u of r.items) if (u.type === "User" && !fromPeople.has(u.login)) { fromPeople.add(u.login); got++; }
          if (r.items.length < PAGE) break;
        }
      }
      // 2. Owners of repositories about the role's topics (location checked below).
      const fromRepos = new Set<string>();
      if (plan.repoQuery) {
        const r = await gh<{ total_count: number; items: { owner: { login: string; type: string } | null }[] }>(`/search/repositories?q=${encodeURIComponent(plan.repoQuery)}&per_page=${PAGE}`);
        estimatedTotal ??= r.total_count;
        for (const it of r.items) if (it.owner?.type === "User" && !fromPeople.has(it.owner.login)) fromRepos.add(it.owner.login);
      }
      // Topic-repository owners first (they show the role's topics), then people by language and place.
      const logins = [...fromRepos, ...fromPeople].slice(0, cap);

      const terms = locationTerms(plan.location);
      let limited = false;
      const profiles = await inBatches(logins, CONCURRENCY, async (login): Promise<RawProfile | null> => {
        if (limited) return null;
        try {
          const user = await gh<GhUser>(`/users/${encodeURIComponent(login)}`);
          // Repository owners weren't location-filtered by GitHub: keep only those whose public
          // location shows the role's location (an empty location is "not established" → skipped).
          if (fromRepos.has(login) && !locationMatches(user.location, terms)) return null;
          const repos = await gh<GhRepo[]>(`/users/${encodeURIComponent(login)}/repos?type=owner&sort=pushed&per_page=30`);
          return profileFromRecord(orgId, githubRecord(user, repos), filters, "GitHub", { relevanceGate: true, years });
        } catch (err) {
          // Out of hourly requests part-way: keep the profiles already read rather than failing the search.
          if (err instanceof SourceError && /rate limit/i.test(err.message)) { limited = true; return null; }
          throw err;
        }
      });
      return { profiles: profiles.filter((p): p is RawProfile => !!p), estimatedTotal, query: this.renderQuery(filters, "") };
    },
  };
}
