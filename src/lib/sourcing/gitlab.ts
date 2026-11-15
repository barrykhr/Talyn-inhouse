import "server-only";
import { checkEnv } from "../integrations/env";
import type { ExternalRecord, RawProfile, SourcingConnector } from "./connectors";
import type { SearchFilters } from "./filters";
import { LANGUAGE } from "./github";
import { cityOf, defaultSourcingLocation, getJson, inBatches, linkedinFrom, locationMatches, locationTerms } from "./http";

/**
 * GitLab sourcing connector (official REST API v4 on gitlab.com, token auth — no scraping).
 * Searches public projects for the role's topics, keeps projects owned by a person (not a
 * group), then reads each owner's public profile and public projects. The project lines are the
 * quoted evidence. A GitLab public email is never stored: contact details must come from your
 * own records, a channel the person published for contact, or a licensed provider.
 */

export const GITLAB_ENV = [{ name: "GITLAB_TOKEN", purpose: "GitLab personal access token with the read_api scope (gitlab.com → Preferences → Access tokens)", secret: true }];

type Deps = { profileFromRecord: typeof import("./connectors").profileFromRecord; SourceError: typeof import("./connectors").SourceError };

const API = "https://gitlab.com/api/v4";
const MAX_TOPICS = 2;
const MAX_PEOPLE = 20; // three API calls each
const PROJECTS_PER_PERSON = 12;

type GlProject = {
  id: number;
  name?: string;
  description?: string | null;
  topics?: string[];
  tag_list?: string[];
  star_count?: number;
  last_activity_at?: string | null;
  web_url?: string;
  forked_from_project?: unknown;
  namespace?: { path?: string; kind?: string } | null;
};
type GlUser = { id: number; username: string; name?: string; state?: string; web_url?: string; bio?: string | null; location?: string | null; linkedin?: string | null; github?: string | null; website_url?: string | null; organization?: string | null; job_title?: string | null; bot?: boolean };

export function planGitlabSearch(filters: SearchFilters) {
  const skills = [...filters.skills_required, ...filters.skills_preferred, ...filters.keywords];
  const language = skills.map((s) => LANGUAGE[s.trim().toLowerCase()]).find((x): x is string => !!x) ?? null;
  const topics = Array.from(new Set([...filters.skills_required, ...filters.keywords].map((s) => s.trim()).filter((s) => s.length > 1 && !LANGUAGE[s.toLowerCase()]))).slice(0, MAX_TOPICS);
  const location = filters.locations[0] ? cityOf(filters.locations[0]) || defaultSourcingLocation() : defaultSourcingLocation();
  return { language, topics, location };
}

const topicsOf = (p: GlProject) => (p.topics?.length ? p.topics : (p.tag_list ?? [])).filter((t) => t.length <= 100);

function linkedinUrl(v: string | null | undefined): string | null {
  const s = v?.trim();
  if (!s) return null;
  if (/linkedin\.com/i.test(s)) return linkedinFrom(s);
  return /^[A-Za-z0-9\-_%]{3,100}$/.test(s) ? `https://www.linkedin.com/in/${s}` : null; // GitLab stores just the handle
}

/** One GitLab person + their projects (matched ones first) → the record shape every Talyn source returns. */
export function gitlabRecord(user: GlUser, matched: GlProject[], recent: GlProject[]): ExternalRecord {
  const seen = new Set<number>();
  const own = [...matched, ...recent].filter((p) => !p.forked_from_project && !seen.has(p.id) && !!seen.add(p.id)).slice(0, PROJECTS_PER_PERSON);
  const lines = own.map((p) =>
    [`${p.name ?? "project"}${p.description?.trim() ? ` — ${p.description.trim().replace(/\s+/g, " ")}` : ""}`, topicsOf(p).length ? `topics: ${topicsOf(p).slice(0, 8).join(", ")}` : null, p.star_count ? `★${p.star_count}` : null, p.last_activity_at ? `last active ${p.last_activity_at.slice(0, 7)}` : null]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 300),
  );
  const website = user.website_url?.trim() && !/linkedin\.com/i.test(user.website_url) ? (/^https?:\/\//i.test(user.website_url.trim()) ? user.website_url.trim() : `https://${user.website_url.trim()}`) : null;
  const github = user.github?.trim() ? (/^https?:\/\//i.test(user.github.trim()) ? user.github.trim() : `https://github.com/${user.github.trim()}`) : null;
  const dates = own.map((p) => p.last_activity_at).filter((d): d is string => !!d).sort();
  return {
    id: `gitlab:${user.username}`,
    url: user.web_url && /^https?:\/\//.test(user.web_url) ? user.web_url : `https://gitlab.com/${encodeURIComponent(user.username)}`,
    name: (user.name?.trim() || user.username).slice(0, 200),
    title: user.job_title?.trim().slice(0, 200) || null, // as the person wrote it on their profile
    company: user.organization?.trim().slice(0, 200) || null,
    location: user.location?.trim().slice(0, 200) || null,
    email: null, // deliberately not taken from GitLab
    linkedinUrl: linkedinUrl(user.linkedin),
    skills: Array.from(new Set(own.flatMap(topicsOf))).slice(0, 60),
    summary: [user.bio?.trim(), github ? `GitHub: ${github}` : null, website ? `Website: ${website}` : null, lines.length ? "Public projects (matching this search first, then most recently active):" : null, ...lines].filter(Boolean).join("\n").slice(0, 20000) || null,
    experience: null,
    updatedAt: dates[dates.length - 1] ?? null,
  };
}

export function makeGitlabConnector({ profileFromRecord, SourceError }: Deps): SourcingConnector {
  const gl = <T>(path: string, allow404 = false) => getJson<T>("GitLab", `${API}${path}`, { authorization: `Bearer ${process.env.GITLAB_TOKEN}` }, SourceError, { allow404 });

  return {
    key: "gitlab",
    label: "GitLab",
    kind: "external",
    description: "Public GitLab.com projects and their owners' public profiles, read through GitLab's official API. Evidence is quoted from project names, descriptions and topics.",
    configured: () => checkEnv(GITLAB_ENV).ready,
    setupHint: "Not connected. Create a GitLab personal access token with the read_api scope and set GITLAB_TOKEN.",
    syntaxNote: "The first two required skills that aren't programming languages are searched in public project names and descriptions (active in the last year); a programming language narrows the projects; owners are kept only when their public profile location shows the role's location (India covers the country and its major cities). Boolean operators are not interpreted.",
    renderQuery(filters) {
      const plan = planGitlabSearch(filters);
      return plan.topics.length ? `projects: ${plan.topics.join(" | ")}${plan.language ? ` · language ${plan.language}` : ""} · owned by a person${plan.location ? ` · location contains "${plan.location}"` : ""}` : "No searchable topics";
    },
    async search({ orgId, filters, years }) {
      const plan = planGitlabSearch(filters);
      if (!plan.topics.length) throw new SourceError("GitLab needs at least one required skill that isn't a programming language, e.g. a framework or tool.");
      const since = new Date(Date.now() - 365 * 86400000).toISOString();
      const byOwner = new Map<string, GlProject[]>();
      for (const topic of plan.topics) {
        const qs = new URLSearchParams({ search: topic, visibility: "public", order_by: "last_activity_at", sort: "desc", last_activity_after: since, per_page: "50" });
        if (plan.language) qs.set("with_programming_language", plan.language);
        const projects = (await gl<GlProject[]>(`/projects?${qs}`)) ?? [];
        for (const p of Array.isArray(projects) ? projects : []) {
          const owner = p.namespace?.kind === "user" ? p.namespace.path : null;
          if (!owner || p.forked_from_project) continue;
          const cur = byOwner.get(owner) ?? [];
          if (!cur.some((x) => x.id === p.id)) byOwner.set(owner, [...cur, p]);
        }
      }
      const owners = [...byOwner.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_PEOPLE);
      const terms = locationTerms(plan.location);

      const profiles = await inBatches(owners, 4, async ([username, matched]): Promise<RawProfile | null> => {
        const found = (await gl<{ id: number }[]>(`/users?username=${encodeURIComponent(username)}`)) ?? [];
        if (!found[0]?.id) return null;
        const user = await gl<GlUser>(`/users/${found[0].id}`, true);
        if (!user || user.bot || (user.state && user.state !== "active")) return null;
        // An empty location is "not established": skipped when the role (or the default) has one.
        if (!locationMatches(user.location, terms)) return null;
        const recent = (await gl<GlProject[]>(`/users/${found[0].id}/projects?visibility=public&order_by=last_activity_at&sort=desc&per_page=20`, true)) ?? [];
        return profileFromRecord(orgId, gitlabRecord(user, matched, Array.isArray(recent) ? recent : []), filters, "GitLab", { relevanceGate: true, years });
      });

      return { profiles: profiles.filter((p): p is RawProfile => !!p), estimatedTotal: byOwner.size, query: this.renderQuery(filters, "") };
    },
  };
}
