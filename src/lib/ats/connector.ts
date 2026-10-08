import "server-only";
import { z } from "zod";
import { checkEnv } from "../integrations/env";

/**
 * ATS connector. No specific ATS is chosen here: the built-in connector speaks a small,
 * documented REST contract (docs/INTEGRATIONS.md) that you point at your ATS — either an ATS
 * whose API you wrap with a thin adapter, or a dedicated connector added later. It stays off
 * until ATS_* variables are set AND a workspace admin links the workspace (Settings → Integrations).
 * Field ownership, duplicates, conflicts and sync failures follow docs/ATS_INTEGRATION.md.
 */

export type AtsApplication = { externalId: string; jobExternalId: string; stage: string };
export type AtsCandidate = {
  externalId: string;
  fullName: string;
  email?: string | null;
  phone?: string | null;
  location?: string | null;
  currentTitle?: string | null;
  currentCompany?: string | null;
  linkedinUrl?: string | null;
  updatedAt: string;
  applications?: AtsApplication[];
};
export type AtsJob = { externalId: string; title: string; status?: string | null };
export type AtsStageChange = { externalApplicationId: string; talynStage: string; atsStage: string; changedByName: string; changedAt: string };

/** Which side is the source of truth when values differ (see docs/ATS_INTEGRATION.md). */
export type Ownership = "ats" | "talyn" | "recruiter_choice";
export const FIELD_OWNERSHIP: Record<string, Ownership> = {
  fullName: "ats",
  email: "ats",
  phone: "ats",
  location: "recruiter_choice",
  currentTitle: "recruiter_choice",
  currentCompany: "recruiter_choice",
  linkedinUrl: "recruiter_choice",
};
export const SYNCED_FIELDS = Object.keys(FIELD_OWNERSHIP) as (keyof typeof FIELD_OWNERSHIP)[];
export const FIELD_LABEL: Record<string, string> = {
  fullName: "Name",
  email: "Email",
  phone: "Phone",
  location: "Location",
  currentTitle: "Current title",
  currentCompany: "Current company",
  linkedinUrl: "LinkedIn URL",
};

export interface AtsConnector {
  key: string;
  label: string;
  /** True when Talyn may push recruiter-made stage changes (needs write access). */
  canPushStages: boolean;
  listJobs(): Promise<AtsJob[]>;
  listStages(jobExternalId: string): Promise<string[]>;
  pullCandidates(since: Date | null, cursor?: string | null): Promise<{ candidates: AtsCandidate[]; nextCursor?: string | null; skipped?: number }>;
  /** Pushes a recruiter-made stage change. Never called for AI output. */
  pushStageChange(change: AtsStageChange): Promise<void>;
}

export const ATS_ENV = [
  { name: "ATS_NAME", purpose: "Name of your ATS, shown to recruiters" },
  { name: "ATS_API_URL", purpose: "HTTPS base URL implementing the Talyn ATS contract (docs/INTEGRATIONS.md)" },
  { name: "ATS_API_KEY", purpose: "Bearer token with read access to jobs, candidates and applications", secret: true },
  { name: "ATS_PUSH_STAGES", purpose: "Set to true to push recruiter stage changes (needs write access)", optional: true },
];

export function atsSetup() {
  const env = checkEnv(ATS_ENV);
  return { ...env, ready: env.ready && /^https:\/\//.test(process.env.ATS_API_URL ?? "") };
}

const Cand = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  email: z.string().max(200).nullish(),
  phone: z.string().max(60).nullish(),
  location: z.string().max(200).nullish(),
  title: z.string().max(200).nullish(),
  company: z.string().max(200).nullish(),
  linkedinUrl: z.string().max(500).nullish(),
  updatedAt: z.string().max(40),
  applications: z.array(z.object({ id: z.string().min(1).max(200), jobId: z.string().min(1).max(200), stage: z.string().max(120) })).max(100).nullish(),
});

async function call<T>(path: string, schema: z.ZodType<T>, init?: RequestInit): Promise<T> {
  const base = process.env.ATS_API_URL!.replace(/\/$/, "");
  const res = await fetch(`${base}${path}`, {
    ...init,
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.ATS_API_KEY}`, ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!res.ok) throw new AtsHttpError(res.status);
  return schema.parse(res.status === 204 ? {} : await res.json());
}

export class AtsHttpError extends Error {
  constructor(public status: number) {
    super(`ATS responded ${status}`);
  }
}

function restConnector(): AtsConnector {
  return {
    key: "rest",
    label: process.env.ATS_NAME!.trim(),
    canPushStages: process.env.ATS_PUSH_STAGES === "true",
    async listJobs() {
      const r = await call("/jobs", z.object({ jobs: z.array(z.object({ id: z.string(), title: z.string(), status: z.string().nullish() })).max(5000) }));
      return r.jobs.map((j) => ({ externalId: j.id, title: j.title, status: j.status }));
    },
    async listStages(jobId) {
      const r = await call(`/jobs/${encodeURIComponent(jobId)}/stages`, z.object({ stages: z.array(z.string().max(120)).max(100) }));
      return r.stages;
    },
    async pullCandidates(since, cursor) {
      const q = new URLSearchParams();
      if (since) q.set("updated_since", since.toISOString());
      if (cursor) q.set("cursor", cursor);
      const r = await call(`/candidates?${q}`, z.object({ candidates: z.array(z.unknown()).max(1000), nextCursor: z.string().nullish() }));
      const candidates: AtsCandidate[] = [];
      for (const raw of r.candidates) {
        const c = Cand.safeParse(raw);
        if (!c.success) continue; // malformed records are reported by count, never guessed at
        candidates.push({
          externalId: c.data.id,
          fullName: c.data.name,
          email: c.data.email?.toLowerCase() ?? null,
          phone: c.data.phone,
          location: c.data.location,
          currentTitle: c.data.title,
          currentCompany: c.data.company,
          linkedinUrl: c.data.linkedinUrl,
          updatedAt: c.data.updatedAt,
          applications: c.data.applications?.map((a) => ({ externalId: a.id, jobExternalId: a.jobId, stage: a.stage })),
        });
      }
      return { candidates, nextCursor: r.nextCursor ?? null, skipped: r.candidates.length - candidates.length };
    },
    async pushStageChange(ch) {
      await call(`/applications/${encodeURIComponent(ch.externalApplicationId)}/stage`, z.unknown(), {
        method: "POST",
        body: JSON.stringify({ stage: ch.atsStage, changedBy: ch.changedByName, changedAt: ch.changedAt }),
      });
    },
  };
}

/** The configured connector, or null. A workspace must also be linked before anything syncs. */
export function getAtsConnector(): AtsConnector | null {
  return atsSetup().ready ? restConnector() : null;
}

export const ATS_SETUP_HINT =
  "No ATS is connected. Tell us which ATS you use and provide API credentials with read access to candidates/applications (and write access to stages, if Talyn should push stage changes). CSV import/export works in the meantime.";
