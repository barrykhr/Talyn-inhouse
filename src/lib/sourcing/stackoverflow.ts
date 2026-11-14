import "server-only";
import { checkEnv } from "../integrations/env";
import type { ExternalRecord, RawProfile, SourcingConnector } from "./connectors";
import type { SearchFilters } from "./filters";
import { cityOf, defaultSourcingLocation, getJson, linkedinFrom } from "./http";

/**
 * Stack Overflow sourcing connector (official Stack Exchange API 2.3).
 * Finds the top answerers for each required skill's tag (all time and last month), then keeps
 * the people whose public profile location matches the role. The API has no location search, so
 * most top answerers are filtered out: expect a short, high-signal list. No emails exist in the
 * API, so none are stored.
 */

export const STACKOVERFLOW_ENV = [{ name: "STACKEXCHANGE_KEY", purpose: "Stack Apps key (free at stackapps.com/apps/oauth/register) — 10,000 requests a day", secret: true }];

type Deps = { profileFromRecord: typeof import("./connectors").profileFromRecord; SourceError: typeof import("./connectors").SourceError };

const API = "https://api.stackexchange.com/2.3";
const MAX_TAGS = 3;
const MAX_PEOPLE = 30;

/** Skill names that differ from their Stack Overflow tag. Anything else: lower-case, spaces → hyphens. */
const TAG_ALIAS: Record<string, string> = {
  spark: "apache-spark",
  kafka: "apache-kafka",
  flink: "apache-flink",
  beam: "apache-beam",
  k8s: "kubernetes",
  postgres: "postgresql",
  golang: "go",
  js: "javascript",
  ts: "typescript",
  react: "reactjs",
  "react native": "react-native",
  node: "node.js",
  nodejs: "node.js",
  aws: "amazon-web-services",
  gcp: "google-cloud-platform",
  "machine learning": "machine-learning",
  "deep learning": "deep-learning",
  llm: "large-language-model",
  nlp: "nlp",
};

export function stackTags(filters: SearchFilters): { skill: string; tag: string }[] {
  const seen = new Set<string>();
  const out: { skill: string; tag: string }[] = [];
  for (const skill of [...filters.skills_required, ...filters.keywords]) {
    const s = skill.trim().toLowerCase();
    const tag = TAG_ALIAS[s] ?? s.replace(/\s+/g, "-");
    if (s.length < 1 || !/^[a-z0-9+#.\-]+$/.test(tag) || seen.has(tag)) continue;
    seen.add(tag);
    out.push({ skill: skill.trim(), tag });
  }
  return out.slice(0, MAX_TAGS);
}

type SeWrapper<T> = { items?: T[]; error_message?: string; error_name?: string; backoff?: number };
type TagScore = { user?: { user_id?: number; user_type?: string }; score?: number; post_count?: number };
type SeUser = { user_id: number; display_name?: string; location?: string; link?: string; reputation?: number; website_url?: string; last_access_date?: number };
type Standing = { skill: string; tag: string; period: "all time" | "the last month"; score: number; posts: number };

const decode = (s: string) => s.replace(/&amp;/g, "&").replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");

export function stackRecord(u: SeUser, standings: Standing[]): ExternalRecord {
  const best = [...standings].sort((a, b) => b.score - a.score);
  const lines = best.map((s) => `Top answerer for ${s.skill} (tag ${s.tag}) over ${s.period}: score ${s.score} from ${s.posts} answers`);
  const website = u.website_url?.trim() && !/linkedin\.com/i.test(u.website_url) ? u.website_url.trim() : null;
  return {
    id: `stackoverflow:${u.user_id}`,
    url: u.link && /^https?:\/\//.test(u.link) ? u.link : `https://stackoverflow.com/users/${u.user_id}`,
    name: decode(u.display_name?.trim() || `User ${u.user_id}`).slice(0, 200),
    title: null,
    company: null,
    location: u.location ? decode(u.location).slice(0, 200) : null,
    email: null,
    linkedinUrl: linkedinFrom(u.website_url),
    skills: Array.from(new Set(best.map((s) => s.skill))),
    summary: [u.reputation != null ? `Stack Overflow reputation: ${u.reputation.toLocaleString("en-US")}` : null, ...lines, website ? `Website: ${website}` : null].filter(Boolean).join("\n"),
    experience: null,
    updatedAt: u.last_access_date ? new Date(u.last_access_date * 1000).toISOString() : null,
  };
}

export function makeStackOverflowConnector({ profileFromRecord, SourceError }: Deps): SourcingConnector {
  async function se<T>(path: string): Promise<T[]> {
    const sep = path.includes("?") ? "&" : "?";
    const body = await getJson<SeWrapper<T>>("Stack Overflow", `${API}${path}${sep}site=stackoverflow&key=${encodeURIComponent(process.env.STACKEXCHANGE_KEY ?? "")}`, {}, SourceError);
    if (body?.error_message) throw new SourceError(body.error_name === "throttle_violation" ? "Stack Overflow's daily quota was reached. Try again tomorrow." : "Stack Overflow couldn't run this search.");
    return body?.items ?? [];
  }

  return {
    key: "stackoverflow",
    label: "Stack Overflow",
    kind: "external",
    description: "Top answerers for the role's required skills on Stack Overflow, from the official Stack Exchange API. A short list of people with demonstrated depth.",
    configured: () => checkEnv(STACKOVERFLOW_ENV).ready,
    setupHint: "Not connected. Register a free key at stackapps.com/apps/oauth/register and set STACKEXCHANGE_KEY.",
    syntaxNote: "Each of the first three required skills is mapped to a Stack Overflow tag and its top answerers (all time and last month) are read; people are kept only when their public profile location shows the role's location. Titles and Boolean operators are not interpreted.",
    renderQuery(filters) {
      const tags = stackTags(filters);
      const loc = filters.locations[0] ? cityOf(filters.locations[0]) : defaultSourcingLocation();
      return tags.length ? `top answerers in ${tags.map((t) => `[${t.tag}]`).join(", ")}${loc ? ` · location contains "${loc}"` : ""}` : "No searchable skills";
    },
    async search({ orgId, filters, years }) {
      const tags = stackTags(filters);
      if (!tags.length) throw new SourceError("Stack Overflow needs at least one required skill to search.");
      const standings = new Map<number, Standing[]>();
      for (const t of tags) {
        for (const [period, label] of [["all_time", "all time"], ["month", "the last month"]] as const) {
          const scores = await se<TagScore>(`/tags/${encodeURIComponent(t.tag)}/top-answerers/${period}?pagesize=100`);
          for (const s of scores) {
            const id = s.user?.user_id;
            if (!id || s.user?.user_type === "does_not_exist") continue;
            standings.set(id, [...(standings.get(id) ?? []), { skill: t.skill, tag: t.tag, period: label, score: s.score ?? 0, posts: s.post_count ?? 0 }]);
          }
        }
      }
      const ids = [...standings.keys()];
      const users: SeUser[] = [];
      for (let i = 0; i < ids.length; i += 100) users.push(...(await se<SeUser>(`/users/${ids.slice(i, i + 100).join(";")}?pagesize=100`)));

      const loc = (filters.locations[0] ? cityOf(filters.locations[0]) : defaultSourcingLocation())?.toLowerCase() ?? null;
      const kept = users
        .filter((u) => !loc || (u.location ?? "").toLowerCase().includes(loc))
        .sort((a, b) => (standings.get(b.user_id)?.length ?? 0) - (standings.get(a.user_id)?.length ?? 0) || (b.reputation ?? 0) - (a.reputation ?? 0))
        .slice(0, MAX_PEOPLE);

      const profiles: RawProfile[] = [];
      for (const u of kept) {
        const p = await profileFromRecord(orgId, stackRecord(u, standings.get(u.user_id) ?? []), filters, "Stack Overflow", { relevanceGate: false, years });
        if (p) profiles.push(p);
      }
      return { profiles, estimatedTotal: ids.length, query: this.renderQuery(filters, "") };
    },
  };
}
