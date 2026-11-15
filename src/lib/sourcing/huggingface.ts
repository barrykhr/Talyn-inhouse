import "server-only";
import { checkEnv } from "../integrations/env";
import type { ExternalRecord, RawProfile, SourcingConnector } from "./connectors";
import type { SearchFilters } from "./filters";
import { getJson, inBatches, isLanguageName } from "./http";

/**
 * Hugging Face sourcing connector — AI/ML roles (official Hub API).
 * Searches public models for the role's topics, groups them by author, and keeps authors that
 * are individual accounts (organisations are skipped). The model lines are the quoted evidence.
 * The Hub does not publish a location or contact details for users, so location is always
 * "not established" here and no contact details are stored.
 */

export const HUGGINGFACE_ENV = [{ name: "HUGGINGFACE_TOKEN", purpose: "Hugging Face access token (read) — huggingface.co/settings/tokens", secret: true }];

type Deps = { profileFromRecord: typeof import("./connectors").profileFromRecord; SourceError: typeof import("./connectors").SourceError };

const HUB = "https://huggingface.co";
const MAX_TERMS = 3;
const MAX_AUTHORS_CHECKED = 60;
const MAX_PEOPLE = 25;

type HfModel = { id?: string; modelId?: string; pipeline_tag?: string; tags?: string[]; downloads?: number; likes?: number; lastModified?: string };
type HfUser = { user?: string; fullname?: string; type?: string; numModels?: number; numDatasets?: number; numSpaces?: number; numFollowers?: number };

export function hfTerms(filters: SearchFilters): string[] {
  return Array.from(new Set([...filters.keywords, ...filters.skills_required].map((s) => s.trim()).filter((s) => s.length > 1 && !isLanguageName(s)))).slice(0, MAX_TERMS);
}

export function hfRecord(login: string, user: HfUser, models: HfModel[]): ExternalRecord {
  const own = [...models].sort((a, b) => (b.downloads ?? 0) - (a.downloads ?? 0)).slice(0, 12);
  const plainTags = (m: HfModel) => (m.tags ?? []).filter((t) => !t.includes(":") && t.length <= 40);
  const skills = Array.from(new Set(own.flatMap((m) => [m.pipeline_tag, ...plainTags(m)]).filter((x): x is string => !!x))).slice(0, 40);
  const lines = own.map((m) =>
    [m.id ?? m.modelId, m.pipeline_tag ? `task: ${m.pipeline_tag}` : null, plainTags(m).length ? `tags: ${plainTags(m).slice(0, 8).join(", ")}` : null, m.downloads ? `${m.downloads.toLocaleString("en-US")} downloads` : null, m.likes ? `${m.likes} likes` : null, m.lastModified ? `updated ${m.lastModified.slice(0, 7)}` : null]
      .filter(Boolean)
      .join(" · ")
      .slice(0, 300),
  );
  const counts = [user.numModels != null ? `${user.numModels} models` : null, user.numDatasets != null ? `${user.numDatasets} datasets` : null, user.numSpaces != null ? `${user.numSpaces} demos` : null, user.numFollowers != null ? `${user.numFollowers} followers` : null].filter(Boolean).join(", ");
  const dates = own.map((m) => m.lastModified).filter((d): d is string => !!d).sort();
  return {
    id: `huggingface:${login}`,
    url: `${HUB}/${encodeURIComponent(login)}`,
    name: (user.fullname?.trim() || login).slice(0, 200),
    title: null,
    company: null, // organisation memberships are not employment; never guessed
    location: null, // the Hub does not publish one
    email: null,
    linkedinUrl: null,
    skills,
    summary: [counts ? `Hugging Face: ${counts}` : null, "Public models matching this search (most downloaded first):", ...lines].filter(Boolean).join("\n").slice(0, 20000),
    experience: null,
    updatedAt: dates[dates.length - 1] ?? null,
    work: { units: lines, unitLabel: "models", lastActiveAt: dates[dates.length - 1] ?? null, popularity: own.reduce((n, m) => n + (m.downloads ?? 0), 0), popularityLabel: "downloads" },
  };
}

export function makeHuggingFaceConnector({ profileFromRecord, SourceError }: Deps): SourcingConnector {
  const headers = () => ({ authorization: `Bearer ${process.env.HUGGINGFACE_TOKEN}` });
  return {
    key: "huggingface",
    label: "Hugging Face",
    kind: "external",
    description: "Individual authors of public machine-learning models on the Hugging Face Hub that match the role's topics. Best for AI and ML engineering roles; location is never shown by this source.",
    configured: () => checkEnv(HUGGINGFACE_ENV).ready,
    setupHint: "Not connected. Create a read token at huggingface.co/settings/tokens and set HUGGINGFACE_TOKEN.",
    syntaxNote: "Each of the first three required skills or search terms (programming languages skipped) is searched in public model names; models are grouped by author and organisation accounts are skipped. The Hub publishes no location, so the role's location cannot be applied. Boolean operators are not interpreted.",
    renderQuery(filters) {
      const terms = hfTerms(filters);
      return terms.length ? `models: ${terms.join(" | ")} · individual authors only · location not available` : "No searchable terms";
    },
    async search({ orgId, filters, years }) {
      const terms = hfTerms(filters);
      if (!terms.length) throw new SourceError("Hugging Face needs at least one required skill or search term.");
      const byAuthor = new Map<string, HfModel[]>();
      for (const term of terms) {
        const qs = new URLSearchParams({ search: term, sort: "downloads", direction: "-1", limit: "60" });
        const models = (await getJson<HfModel[]>("Hugging Face", `${HUB}/api/models?${qs}`, headers(), SourceError)) ?? [];
        for (const m of Array.isArray(models) ? models : []) {
          const id = m.id ?? m.modelId;
          if (!id || !id.includes("/")) continue;
          const author = id.split("/")[0];
          const cur = byAuthor.get(author) ?? [];
          if (!cur.some((x) => (x.id ?? x.modelId) === id)) byAuthor.set(author, [...cur, m]);
        }
      }
      // Authors with the most matching models first; organisations are dropped when the user lookup 404s.
      const authors = [...byAuthor.entries()].sort((a, b) => b[1].length - a[1].length).slice(0, MAX_AUTHORS_CHECKED);
      const people = (
        await inBatches(authors, 6, async ([login, models]) => {
          const user = await getJson<HfUser>("Hugging Face", `${HUB}/api/users/${encodeURIComponent(login)}/overview`, headers(), SourceError, { allow404: true });
          return user && user.type !== "org" ? { login, user, models } : null;
        })
      )
        .filter((x): x is { login: string; user: HfUser; models: HfModel[] } => !!x)
        .slice(0, MAX_PEOPLE);

      const profiles: RawProfile[] = [];
      for (const { login, user, models } of people) {
        const p = await profileFromRecord(orgId, hfRecord(login, user, models), filters, "Hugging Face", { relevanceGate: false, years });
        if (p) profiles.push(p);
      }
      return { profiles, estimatedTotal: byAuthor.size, query: this.renderQuery(filters, "") };
    },
  };
}
