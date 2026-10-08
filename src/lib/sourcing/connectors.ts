import "server-only";
import { db } from "../db";
import { locateQuote } from "../evidence";
import type { SearchFilters } from "./filters";

/**
 * Sourcing connectors. Talyn only searches data it is authorized to use: the customer's own
 * Talyn records, or a licensed provider/API connected by the customer. No scraping and no
 * automated access to sites without an authorized data path.
 */

export type Signal = { category: string; term: string; matched: boolean; quote: string | null; page: number | null };
export type FieldFact = { value: string; source: string; asOf: string };
export type RawProfile = {
  sourceRecordId: string;
  sourceUrl: string | null;
  displayName: string;
  currentTitle: string | null;
  currentCompany: string | null;
  location: string | null;
  fields: Record<string, FieldFact>;
  signals: Signal[];
  evidenceStatus: "ok" | "insufficient" | "stale";
  staleReason: string | null;
  excludedBy: string | null;
  duplicateCandidateId: string | null;
  duplicateReason: string | null;
};
export type SearchOutcome = { profiles: RawProfile[]; estimatedTotal: number | null; query: string };

export interface SourcingConnector {
  key: string;
  label: string;
  kind: "internal" | "external";
  description: string;
  configured(): boolean;
  setupHint: string;
  /** How this source interprets the strategy. Boolean is not assumed to behave the same everywhere. */
  syntaxNote: string;
  renderQuery(filters: SearchFilters, booleanQuery: string): string;
  search(ctx: { orgId: string; roleId: string; filters: SearchFilters; booleanQuery: string }): Promise<SearchOutcome>;
}

const STALE_MONTHS = 18;

function findTerm(pages: string[], term: string): { quote: string; page: number | null } | null {
  const t = term.trim();
  if (t.length < 2) return null;
  const re = new RegExp(`(^|[^\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+")}($|[^\\p{L}\\p{N}])`, "iu");
  for (let p = 0; p < pages.length; p++) {
    const lines = pages[p].split("\n");
    const line = lines.find((l) => re.test(l));
    if (line) {
      const loc = locateQuote({ resumePages: pages, profileText: "" }, line.trim().slice(0, 240), "resume");
      return { quote: line.trim().slice(0, 240), page: loc.page ?? (pages.length > 1 ? p + 1 : null) };
    }
  }
  return null;
}

/** Talyn rediscovery: the organization's own candidates (customer data), excluding those already in this role. */
const talynRediscovery: SourcingConnector = {
  key: "talyn",
  label: "Talyn rediscovery",
  kind: "internal",
  description: "Candidates already in your Talyn workspace who aren't in this role's pipeline.",
  configured: () => true,
  setupHint: "",
  syntaxNote: "Uses the structured filters (titles, skills, locations, exclusions) as case-insensitive matches against each candidate's current CV and profile. Boolean operators are not interpreted.",
  renderQuery(f) {
    return [
      f.titles.length ? `title ∈ {${f.titles.join(", ")}}` : null,
      f.skills_required.length ? `all of {${f.skills_required.join(", ")}}` : null,
      f.skills_preferred.length ? `any of {${f.skills_preferred.join(", ")}}` : null,
      f.locations.length ? `location ∈ {${f.locations.join(", ")}}` : null,
      f.exclusions.length ? `exclude {${f.exclusions.join(", ")}}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
  },
  async search({ orgId, roleId, filters }) {
    const candidates = await db.candidate.findMany({
      where: { orgId, applications: { none: { roleId } } },
      select: {
        id: true,
        fullName: true,
        currentTitle: true,
        currentCompany: true,
        location: true,
        candidateSummary: true,
        updatedAt: true,
        extractionStatus: true,
        resumes: { where: { isCurrent: true }, take: 1, select: { pagesJson: true, createdAt: true } },
      },
      take: 2000,
      orderBy: { updatedAt: "desc" },
    });
    const now = Date.now();
    const profiles: RawProfile[] = [];
    for (const c of candidates) {
      const resume = c.resumes[0];
      const pages = resume ? (JSON.parse(resume.pagesJson) as string[]) : [];
      const profileText = [c.currentTitle, c.currentCompany, c.location, c.candidateSummary].filter(Boolean).join("\n");
      const searchable = [...pages, profileText];
      const sig = (category: string, term: string): Signal => {
        const hit = findTerm(searchable, term);
        return { category, term, matched: !!hit, quote: hit?.quote ?? null, page: hit && hit.page && hit.page <= pages.length ? hit.page : null };
      };
      const signals = [
        ...filters.titles.map((t) => sig("title", t)),
        ...filters.skills_required.map((t) => sig("skill_required", t)),
        ...filters.skills_preferred.map((t) => sig("skill_preferred", t)),
        ...filters.locations.map((t) => sig("location", t)),
      ];
      // Only return people with at least one matched title or required skill: a relevance gate, not a judgement.
      if (!signals.some((s) => s.matched && (s.category === "title" || s.category === "skill_required"))) continue;
      const excl = filters.exclusions.find((e) => findTerm(searchable, e));
      const ageMonths = resume ? (now - resume.createdAt.getTime()) / (30 * 86400000) : null;
      profiles.push({
        sourceRecordId: c.id,
        sourceUrl: `/candidates/${c.id}`,
        displayName: c.fullName,
        currentTitle: c.currentTitle,
        currentCompany: c.currentCompany,
        location: c.location,
        fields: Object.fromEntries(
          (
            [
              ["current_title", c.currentTitle],
              ["current_company", c.currentCompany],
              ["location", c.location],
            ] as const
          )
            .filter(([, v]) => v)
            .map(([k, v]) => [k, { value: v as string, source: c.extractionStatus === "needs_review" ? "Talyn profile (CV extraction not yet reviewed)" : "Talyn profile", asOf: c.updatedAt.toISOString() }]),
        ),
        signals,
        evidenceStatus: !resume ? "insufficient" : ageMonths !== null && ageMonths > STALE_MONTHS ? "stale" : "ok",
        staleReason: ageMonths !== null && ageMonths > STALE_MONTHS ? `CV on file is ${Math.round(ageMonths)} months old` : !resume ? "No CV on file — matched on profile fields only" : null,
        excludedBy: excl ?? null,
        duplicateCandidateId: null, // the record *is* the Talyn candidate
        duplicateReason: null,
      });
    }
    return { profiles, estimatedTotal: null, query: this.renderQuery(filters, "") };
  },
};

/**
 * External provider slot. No provider is selected for this workspace, so this connector reports
 * a setup state and never returns results. Implementing a provider = a SourcingConnector that
 * calls the provider's licensed API with credentials from the environment.
 */
const externalProvider: SourcingConnector = {
  key: "external",
  label: "External talent data provider",
  kind: "external",
  description: "A licensed people-data provider or job-board API connected with your organization's credentials.",
  configured: () => false,
  setupHint:
    "Not connected. Choose a licensed talent-data provider (or a job board with an approved API), confirm your organization's licence covers this use, and add its API credentials. Talyn will not scrape websites or automate access without an authorized data path.",
  syntaxNote: "Each provider has its own query syntax and limits; the Boolean query is translated per provider and may not behave identically.",
  renderQuery: (_f, b) => b,
  async search() {
    throw new Error("External sourcing provider is not configured.");
  },
};

export const CONNECTORS: SourcingConnector[] = [talynRediscovery, externalProvider];
export const connector = (key: string) => CONNECTORS.find((c) => c.key === key);

/** Duplicate check against existing Talyn candidates (used for external profiles). */
export async function findDuplicate(orgId: string, p: { email?: string | null; linkedinUrl?: string | null; name: string; company?: string | null }) {
  if (p.email) {
    const c = await db.candidate.findFirst({ where: { orgId, email: p.email.toLowerCase() }, select: { id: true } });
    if (c) return { id: c.id, reason: "Same email as an existing candidate" };
  }
  if (p.linkedinUrl) {
    const c = await db.candidate.findFirst({ where: { orgId, linkedinUrl: p.linkedinUrl }, select: { id: true } });
    if (c) return { id: c.id, reason: "Same LinkedIn URL as an existing candidate" };
  }
  if (p.company) {
    const c = await db.candidate.findFirst({ where: { orgId, fullName: { equals: p.name, mode: "insensitive" }, currentCompany: { equals: p.company, mode: "insensitive" } }, select: { id: true } });
    if (c) return { id: c.id, reason: "Same name and current company — possible duplicate" };
  }
  return null;
}
