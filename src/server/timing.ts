import "server-only";
import { companyKey } from "@/lib/calls/core";
import { db } from "@/lib/db";
import { sourceLabel } from "@/lib/sourcing/connectors";
import { profileDiff, timingScore, workFacts, type CompanyEvent, type Job, type ProfileChange } from "@/lib/timing";

const STALE_MS = 14 * 86_400_000;

export async function cachedEvents(orgId: string, company: string | null | undefined) {
  if (!company?.trim()) return null;
  const row = await db.companyEvents.findUnique({ where: { orgId_companyKey: { orgId, companyKey: companyKey(company) } } });
  return row ? { name: row.name, events: JSON.parse(row.eventsJson) as CompanyEvent[], checkedAt: row.checkedAt, stale: Date.now() - row.checkedAt.getTime() > STALE_MS } : null;
}

/** Changes between observations of the same public profile across searches Talyn ran. */
async function changesFor(orgId: string, refs: { source: string; sourceRecordId: string }[]): Promise<Map<string, ProfileChange[]>> {
  const out = new Map<string, ProfileChange[]>();
  if (!refs.length) return out;
  const rows = await db.sourcedProfile.findMany({
    where: { orgId, OR: refs.map((r) => ({ source: r.source, sourceRecordId: r.sourceRecordId })) },
    orderBy: { retrievedAt: "asc" },
    select: { source: true, sourceRecordId: true, currentTitle: true, currentCompany: true, location: true, retrievedAt: true, fieldsJson: true },
  });
  const last = new Map<string, (typeof rows)[number]>();
  const headline = (r: (typeof rows)[number]) => {
    try {
      return (JSON.parse(r.fieldsJson) as Record<string, { value?: string }>).headline?.value ?? null;
    } catch {
      return null;
    }
  };
  for (const r of rows) {
    const k = `${r.source}|${r.sourceRecordId}`;
    const prev = last.get(k);
    if (prev) out.set(k, [...(out.get(k) ?? []), ...profileDiff({ ...prev, headline: headline(prev) }, { ...r, headline: headline(r) }, r.retrievedAt, `${sourceLabel(r.source)}, seen ${r.retrievedAt.toISOString().slice(0, 10)}`)]);
    last.set(k, r);
  }
  return out;
}

/** Timing for one candidate in Talyn. */
export async function timingForCandidate(orgId: string, candidateId: string) {
  const c = await db.candidate.findFirst({
    where: { id: candidateId, orgId },
    select: {
      currentCompany: true,
      extracted: { where: { field: "work_history", status: { not: "rejected" } }, select: { valueJson: true, editedValueJson: true, sourceQuote: true } },
      applications: { select: { interest: true, sourcedProfileId: true } },
    },
  });
  if (!c) return null;
  const jobs: Job[] = c.extracted.map((f) => ({ ...(JSON.parse(f.editedValueJson ?? f.valueJson) as Job), quote: f.sourceQuote }));
  const work = workFacts(jobs);
  const company = c.currentCompany || work?.employer || null;
  const spIds = c.applications.map((a) => a.sourcedProfileId).filter((x): x is string => !!x);
  const linked = spIds.length ? await db.sourcedProfile.findMany({ where: { orgId, id: { in: spIds } }, select: { source: true, sourceRecordId: true } }) : [];
  const [events, changes] = await Promise.all([cachedEvents(orgId, company), changesFor(orgId, linked)]);
  const t = timingScore({ work, events: events?.events ?? [], changes: [...changes.values()].flat(), saidInterested: c.applications.some((a) => a.interest === "interested") });
  return { ...t, company, events };
}

/** Timing for Discover results (public profiles: company news and profile changes only). */
export async function timingForSourced(orgId: string, profiles: { id: string; source: string; sourceRecordId: string; currentCompany: string | null }[]) {
  const changes = await changesFor(orgId, profiles.map((p) => ({ source: p.source, sourceRecordId: p.sourceRecordId })));
  const companies = [...new Set(profiles.map((p) => p.currentCompany).filter((x): x is string => !!x?.trim()))];
  const rows = companies.length ? await db.companyEvents.findMany({ where: { orgId, companyKey: { in: companies.map(companyKey) } } }) : [];
  const ev = new Map(rows.map((r) => [r.companyKey, JSON.parse(r.eventsJson) as CompanyEvent[]]));
  const out = new Map<string, ReturnType<typeof timingScore>>();
  for (const p of profiles) {
    const mine = changes.get(`${p.source}|${p.sourceRecordId}`) ?? [];
    out.set(p.id, timingScore({ work: null, events: p.currentCompany ? (ev.get(companyKey(p.currentCompany)) ?? []) : [], changes: mine, saidInterested: false }));
  }
  return out;
}

/** Timing for a handful of candidates (shortlists). Capped; the rest show none. */
export async function timingForCandidates(orgId: string, ids: string[], cap = 40) {
  const out = new Map<string, { score: number | null; band: ReturnType<typeof timingScore>["band"]; top: string | null }>();
  for (const id of [...new Set(ids)].slice(0, cap)) {
    const t = await timingForCandidate(orgId, id);
    if (t) out.set(id, { score: t.score, band: t.band, top: t.signals.map((x) => `${x.label}: ${x.detail}`).join(" · ") || null });
  }
  return out;
}
