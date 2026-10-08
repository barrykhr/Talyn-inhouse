import "server-only";
import { db } from "../db";
import { locateQuote } from "../evidence";
import { z } from "zod";
import { checkEnv } from "../integrations/env";
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

/** A profile record from an authorized external source (provider API or an imported export). */
export const ExternalRecord = z.object({
  id: z.string().min(1).max(200),
  url: z.string().url().max(500).nullish(),
  name: z.string().min(1).max(200),
  title: z.string().max(200).nullish(),
  company: z.string().max(200).nullish(),
  location: z.string().max(200).nullish(),
  email: z.string().email().max(200).nullish(),
  linkedinUrl: z.string().url().max(500).nullish(),
  skills: z.array(z.string().max(100)).max(200).nullish(),
  summary: z.string().max(20000).nullish(),
  experience: z
    .array(z.object({ title: z.string().max(200).nullish(), company: z.string().max(200).nullish(), start: z.string().max(40).nullish(), end: z.string().max(40).nullish(), description: z.string().max(5000).nullish() }))
    .max(50)
    .nullish(),
  updatedAt: z.string().max(40).nullish(),
});
export type ExternalRecord = z.infer<typeof ExternalRecord>;

/**
 * Turns a source record into a reviewable profile. Signals are quoted only from text the source
 * returned; contact details are kept only if the source provided them (never inferred).
 */
export async function profileFromRecord(orgId: string, r: ExternalRecord, filters: SearchFilters, sourceLabel: string, opts: { relevanceGate: boolean }): Promise<RawProfile | null> {
  const asOf = r.updatedAt && !Number.isNaN(Date.parse(r.updatedAt)) ? new Date(r.updatedAt).toISOString() : new Date().toISOString();
  const lines = [
    [r.title, r.company].filter(Boolean).join(" at "),
    r.location ?? "",
    r.skills?.length ? `Skills: ${r.skills.join(", ")}` : "",
    ...(r.experience ?? []).flatMap((e) => [[e.title, e.company, [e.start, e.end].filter(Boolean).join("–")].filter(Boolean).join(" · "), e.description ?? ""]),
    r.summary ?? "",
  ].filter((l) => l.trim());
  const text = [lines.join("\n")];
  const sig = (category: string, term: string): Signal => {
    const hit = findTerm(text, term);
    return { category, term, matched: !!hit, quote: hit?.quote ?? null, page: null };
  };
  const signals = [
    ...filters.titles.map((t) => sig("title", t)),
    ...filters.skills_required.map((t) => sig("skill_required", t)),
    ...filters.skills_preferred.map((t) => sig("skill_preferred", t)),
    ...filters.locations.map((t) => sig("location", t)),
  ];
  if (opts.relevanceGate && !signals.some((s) => s.matched && (s.category === "title" || s.category === "skill_required"))) return null;
  const excl = filters.exclusions.find((e) => findTerm(text, e));
  const ageMonths = r.updatedAt && !Number.isNaN(Date.parse(r.updatedAt)) ? (Date.now() - Date.parse(r.updatedAt)) / (30 * 86400000) : null;
  const dup = await findDuplicate(orgId, { email: r.email, linkedinUrl: r.linkedinUrl, name: r.name, company: r.company });
  const fact = (v: string | null | undefined) => (v ? { value: v, source: sourceLabel, asOf } : null);
  const fields = Object.fromEntries(
    (
      [
        ["current_title", fact(r.title)],
        ["current_company", fact(r.company)],
        ["location", fact(r.location)],
        ["email", fact(r.email)],
        ["linkedin_url", fact(r.linkedinUrl)],
      ] as const
    ).filter(([, f]) => f) as [string, FieldFact][],
  );
  return {
    sourceRecordId: r.id,
    sourceUrl: r.url ?? null,
    displayName: r.name,
    currentTitle: r.title ?? null,
    currentCompany: r.company ?? null,
    location: r.location ?? null,
    fields,
    signals,
    evidenceStatus: lines.length <= 1 ? "insufficient" : ageMonths !== null && ageMonths > STALE_MONTHS ? "stale" : "ok",
    staleReason: lines.length <= 1 ? "The source returned little profile text" : ageMonths !== null && ageMonths > STALE_MONTHS ? `Profile last updated ${Math.round(ageMonths)} months ago` : !r.updatedAt ? "The source didn't say when this profile was last updated" : null,
    excludedBy: excl ?? null,
    duplicateCandidateId: dup?.id ?? null,
    duplicateReason: dup?.reason ?? null,
  };
}

export const SOURCING_ENV = [
  { name: "SOURCING_PROVIDER_NAME", purpose: "Name shown to recruiters, e.g. the licensed provider or your internal talent-data service" },
  { name: "SOURCING_API_URL", purpose: "HTTPS endpoint implementing the Talyn sourcing contract (docs/INTEGRATIONS.md)" },
  { name: "SOURCING_API_KEY", purpose: "Bearer token for that endpoint", secret: true },
];

const SearchResponse = z.object({ estimatedTotal: z.number().int().nonnegative().nullish(), profiles: z.array(z.unknown()).max(500) });

/**
 * Authorized provider API. Vendor-neutral: Talyn POSTs the saved search to an endpoint you
 * control or license (a provider's API, or a small adapter in front of one) and reviews what it
 * returns. Off until SOURCING_* variables are set. Talyn never scrapes or automates logins.
 */
const externalProvider: SourcingConnector = {
  key: "external",
  get label() {
    return process.env.SOURCING_PROVIDER_NAME?.trim() || "External talent data provider";
  },
  kind: "external",
  description: "A licensed people-data provider or job-board API connected with your organization's credentials.",
  configured: () => checkEnv(SOURCING_ENV).ready && /^https:\/\//.test(process.env.SOURCING_API_URL ?? ""),
  setupHint:
    "Not connected. Choose a licensed talent-data provider (or a job board with an approved API), confirm your organization's licence covers this use, and set SOURCING_PROVIDER_NAME, SOURCING_API_URL and SOURCING_API_KEY. Meanwhile you can import an export from a source you're licensed to use. Talyn will not scrape websites or automate access without an authorized data path.",
  syntaxNote: "Talyn sends the structured filters and the generic Boolean string; the provider decides how to interpret them, so results may not match Boolean semantics exactly.",
  renderQuery: (_f, b) => b,
  async search({ orgId, filters, booleanQuery }) {
    const res = await fetch(process.env.SOURCING_API_URL!, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${process.env.SOURCING_API_KEY}` },
      body: JSON.stringify({ filters, booleanQuery, limit: 100 }),
      signal: AbortSignal.timeout(60_000),
      cache: "no-store",
    });
    if (!res.ok) throw new Error(`Sourcing provider responded ${res.status}`);
    const body = SearchResponse.parse(await res.json());
    const profiles: RawProfile[] = [];
    for (const raw of body.profiles) {
      const rec = ExternalRecord.safeParse(raw);
      if (!rec.success) continue; // malformed records are skipped, not guessed at
      const p = await profileFromRecord(orgId, rec.data, filters, this.label, { relevanceGate: false });
      if (p) profiles.push(p);
    }
    return { profiles, estimatedTotal: body.estimatedTotal ?? null, query: booleanQuery };
  },
};

export const CONNECTORS: SourcingConnector[] = [talynRediscovery, externalProvider];
export const connector = (key: string) => CONNECTORS.find((c) => c.key === key);
/** Display label for a stored source key (connectors plus imported files). */
export const sourceLabel = (key: string) => (key === "file" ? "Imported file" : (connector(key)?.label ?? key));

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
