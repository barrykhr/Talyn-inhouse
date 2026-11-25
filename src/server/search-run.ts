import "server-only";
import type { AuthContext } from "@/lib/auth";
import { AiRequestError, AiUnavailableError, aiStatus, rankProfilesWithAi, type ProfileRank } from "@/lib/ai";
import { audit } from "@/lib/audit";
import { db } from "@/lib/db";
import type { BriefFields } from "@/lib/discovery/brief";
import { redactContact } from "@/lib/extraction";
import { logError } from "@/lib/log";
import { SourceError, connector, type RawProfile } from "@/lib/sourcing/connectors";
import { EMPTY_FILTERS, parseSynonyms, type SearchFilters } from "@/lib/sourcing/filters";
import { cosine, hashText, sourcedText, stripContact } from "@/lib/semantic/core";
import { embedTexts, embeddingStatus } from "@/lib/semantic/embed";
import { mergeAcrossSources, type MergedProfile } from "@/lib/sourcing/merge";
import { computeRelevance, type Relevance } from "@/lib/sourcing/relevance";

/**
 * One Discover search: runs each chosen source, merges people found in several sources, scores
 * relevance, optionally asks AI to order the top results, and stores the run. Used by the
 * recruiter's Search button and by automatic searches (criteria approved, daily re-run).
 * Nothing here contacts, rejects or adds anyone to a pipeline.
 */

const AI_RANK_TOP = 50;
const AI_BATCH = 10;
const FIT_ORDER: Record<string, number> = { strong: 0, partial: 1, unclear: 2, weak: 3 };
type AiRankOutcome = { status: "off" | "ok" | "partial" | "error" | "skipped"; ranked: number; note?: string };

/** Quotes are kept only when they appear in the profile's own text (spacing and case ignored). */
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, " ").trim();

/**
 * Optional: the AI orders the top results by how well their public work shows the role's approved
 * criteria. It only orders; everyone stays listed and nothing is decided or sent.
 */
async function rankWithAi(auth: AuthContext, roleId: string, roleTitle: string, scored: { p: MergedProfile; rel: Relevance }[]) {
  const ranks = new Map<string, { rank: number; fit: ProfileRank & { verified: { criterion: string; quote: string }[] } }>();
  if (!aiStatus().configured) return { ranks, outcome: { status: "skipped", ranked: 0, note: "AI isn't configured, so results are ordered by relevance score only." } as AiRankOutcome };
  const criteria = await db.criterion.findMany({ where: { roleId, orgId: auth.orgId, status: "approved" }, select: { id: true, name: true, description: true, importance: true, kind: true } });
  if (!criteria.length) return { ranks, outcome: { status: "skipped", ranked: 0, note: "AI ranking needs approved role criteria. Approve them on the Criteria tab." } as AiRankOutcome };
  const top = scored.filter((x) => !x.p.excludedBy).sort((a, b) => b.rel.score - a.rel.score).slice(0, AI_RANK_TOP);
  const byId = new Map(top.map((x, i) => [`p${i + 1}`, x]));
  const batches: [string, (typeof top)[number]][][] = [];
  const entries = [...byId.entries()];
  for (let i = 0; i < entries.length; i += AI_BATCH) batches.push(entries.slice(i, i + AI_BATCH));
  const results: (ProfileRank & { id: string })[] = [];
  let failed = 0;
  let lastError = "";
  for (let i = 0; i < batches.length; i += 3) {
    await Promise.all(
      batches.slice(i, i + 3).map(async (batch) => {
        try {
          const out = await rankProfilesWithAi({
            roleTitle,
            criteria: criteria.map((c) => ({ ...c, description: c.description ?? "" })),
            profiles: batch.map(([id, x]) => ({ id, text: redactContact(x.p.text).slice(0, 3500) })),
          });
          for (const r of out) if (byId.has(r.profile_id) && batch.some(([id]) => id === r.profile_id)) results.push({ ...r, id: r.profile_id });
        } catch (err) {
          failed++;
          lastError = err instanceof AiRequestError || err instanceof AiUnavailableError ? err.message : "The AI request failed.";
          if (!(err instanceof AiRequestError)) logError("discover.ai_rank_failed", err, { roleId });
        }
      }),
    );
  }
  const names = new Map(criteria.map((c) => [c.id, c.name]));
  const ordered = results
    .map((r) => ({ r, x: byId.get(r.id)! }))
    .sort((a, b) => (FIT_ORDER[a.r.fit] ?? 9) - (FIT_ORDER[b.r.fit] ?? 9) || b.x.rel.score - a.x.rel.score);
  ordered.forEach(({ r, x }, i) => {
    const text = norm(x.p.text);
    const verified = r.evidence.filter((e) => e.quote.trim().length > 3 && text.includes(norm(e.quote)) && names.has(e.criterion_id)).slice(0, 4).map((e) => ({ criterion: names.get(e.criterion_id)!, quote: e.quote.trim() }));
    ranks.set(x.p.sourceKey + "|" + x.p.sourceRecordId, { rank: i + 1, fit: { ...r, verified } });
  });
  const outcome: AiRankOutcome = !failed
    ? { status: "ok", ranked: ordered.length }
    : ordered.length
      ? { status: "partial", ranked: ordered.length, note: `Some AI requests failed (${lastError}); the rest are ordered by relevance score.` }
      : { status: "error", ranked: 0, note: `AI ranking failed: ${lastError} Results are ordered by relevance score.` };
  return { ranks, outcome };
}

type SourceStatus = { key: string; label: string; status: "ok" | "error" | "setup_required"; count: number; error?: string };


export type SearchRunResult = { error: string } | { anyOk: boolean; runId: string; statuses: SourceStatus[]; added: number; found: number };

export async function executeSearch(
  auth: AuthContext,
  roleId: string,
  brief: { booleanQuery: string; synonymsJson?: string | null },
  f: BriefFields,
  opts: { demo: boolean; keys: string[]; onlyNew?: boolean; targetCompanies?: string[] },
): Promise<SearchRunResult> {
  const demo = opts.demo;
  const chosen = opts.keys.map((k) => connector(k)).filter((c): c is NonNullable<typeof c> => !!c && (demo ? c.kind === "sample" : c.kind !== "sample"));
  if (!chosen.length) return { error: demo ? "Demo mode isn't available because a live source is connected." : "Choose at least one connected source." };

  const filters: SearchFilters = {
    ...EMPTY_FILTERS,
    titles: [f.roleName],
    adjacent_titles: f.altTitles,
    skills_required: f.skillsRequired,
    skills_preferred: f.skillsPreferred,
    locations: f.location && f.workArrangement !== "remote" ? [f.location] : [],
    exclusions: f.exclusions,
    target_companies: (opts.targetCompanies ?? []).map((t) => t.trim()).filter(Boolean).slice(0, 60),
    synonyms: parseSynonyms(brief.synonymsJson, [f.roleName, ...f.altTitles, ...f.skillsRequired, ...f.skillsPreferred]),
  };
  const years = { min: f.minYears, max: f.maxYears };
  const last = await db.searchStrategy.findFirst({ where: { roleId }, orderBy: { version: "desc" } });
  const strategy = await db.searchStrategy.create({
    data: {
      orgId: auth.orgId,
      roleId,
      version: (last?.version ?? 0) + 1,
      request: "",
      filtersJson: JSON.stringify(filters),
      booleanQuery: brief.booleanQuery,
      planJson: JSON.stringify({ years, workArrangement: f.workArrangement }),
      generator: "discovery-brief",
      createdByName: auth.userName,
    },
  });

  // Each source runs independently. A failing source is reported; nothing is substituted for it.
  const statuses: SourceStatus[] = [];
  const batches: { key: string; label: string; retrievedAt: string; profiles: RawProfile[] }[] = [];
  let estimatedTotal: number | null = null;
  for (const c of chosen) {
    if (!c.configured()) {
      statuses.push({ key: c.key, label: c.label, status: "setup_required", count: 0, error: "Not connected" });
      continue;
    }
    try {
      const out = await c.search({ orgId: auth.orgId, roleId, filters, booleanQuery: brief.booleanQuery, years });
      batches.push({ key: c.key, label: c.label, retrievedAt: new Date().toISOString(), profiles: out.profiles });
      if (out.estimatedTotal != null) estimatedTotal = (estimatedTotal ?? 0) + out.estimatedTotal;
      statuses.push({ key: c.key, label: c.label, status: "ok", count: out.profiles.length });
    } catch (err) {
      logError("discover.source_failed", err, { source: c.key });
      statuses.push({ key: c.key, label: c.label, status: "error", count: 0, error: err instanceof SourceError ? err.message : `${c.label} couldn't be reached or returned an unexpected response.` });
    }
  }
  let merged = mergeAcrossSources(batches);
  if (opts.onlyNew && merged.length) {
    const seen = await db.sourcedProfile.findMany({ where: { orgId: auth.orgId, roleId }, select: { source: true, sourceRecordId: true } });
    const known = new Set(seen.map((x) => `${x.source}|${x.sourceRecordId}`));
    merged = merged.filter((p) => !p.sources.some((s) => known.has(`${s.key}|${s.recordId}`)));
  }
  const fresh = merged;
  // Relevance: required skills evidenced, depth and recency of public work. Ordering only.
  const brief2 = await db.discoveryBrief.findUnique({ where: { roleId }, select: { minRequiredSkills: true, aiRankTop: true, describedAs: true } });
  // Closeness in meaning to the role: up to 10 relevance points. If it can't run, nothing else changes.
  const meaning = await meaningFor(auth.orgId, roleId, f, brief2?.describedAs ?? null, merged);
  const scored = merged.map((p) => ({ p, rel: computeRelevance(p.signals, p.work, brief2?.minRequiredSkills ?? null, Date.now(), meaning.sims.get(p) ?? null) }));
  const role = await db.role.findUnique({ where: { id: roleId }, select: { title: true } });
  const ai = brief2?.aiRankTop && scored.length ? await rankWithAi(auth, roleId, role?.title ?? f.roleName, scored) : { ranks: new Map(), outcome: { status: "off", ranked: 0 } as AiRankOutcome };
  await db.searchStrategy.update({ where: { id: strategy.id }, data: { planJson: JSON.stringify({ years, workArrangement: f.workArrangement, minRequiredSkills: brief2?.minRequiredSkills ?? null, aiRank: ai.outcome, meaning: meaning.outcome }) } });
  const excluded = merged.filter((p) => p.excludedBy).length;
  const anyOk = statuses.some((s) => s.status === "ok");
  const run = await db.searchRun.create({
    data: {
      orgId: auth.orgId,
      roleId,
      strategyId: strategy.id,
      source: chosen.map((c) => c.key).join("+"),
      isDemo: demo,
      sourcesJson: JSON.stringify(statuses),
      status: anyOk ? "completed" : "failed",
      query: brief.booleanQuery,
      resultCount: merged.length - excluded,
      excludedCount: excluded,
      estimatedTotal,
      error: anyOk ? null : "No source returned results.",
      createdByName: auth.userName,
    },
  });
  if (merged.length)
    await db.sourcedProfile.createMany({
      data: merged.map((p) => ({
        orgId: auth.orgId,
        roleId,
        runId: run.id,
        source: p.sourceKey,
        sourceRecordId: p.sourceRecordId,
        sourceUrl: p.sourceUrl,
        sourcesJson: JSON.stringify(p.sources),
        displayName: p.displayName,
        currentTitle: p.currentTitle,
        currentCompany: p.currentCompany,
        location: p.location,
        fieldsJson: JSON.stringify(p.fields),
        signalsJson: JSON.stringify(p.signals),
        profileText: p.text ? stripContact(p.text).slice(0, 8000) : null,
        matchedSignals: p.signals.filter((s) => s.matched).length,
        relevanceScore: scored.find((x) => x.p === p)!.rel.score,
        relevanceJson: JSON.stringify(scored.find((x) => x.p === p)!.rel),
        aiRank: ai.ranks.get(p.sourceKey + "|" + p.sourceRecordId)?.rank ?? null,
        aiFitJson: (() => {
          const r = ai.ranks.get(p.sourceKey + "|" + p.sourceRecordId);
          return r ? JSON.stringify({ fit: r.fit.fit, summary: r.fit.summary, evidence: r.fit.verified, model: aiStatus().model }) : null;
        })(),
        totalSignals: p.signals.length,
        evidenceStatus: p.evidenceStatus,
        staleReason: p.staleReason,
        duplicateCandidateId: p.duplicateCandidateId,
        duplicateReason: p.duplicateReason,
        excludedBy: p.excludedBy,
        status: p.excludedBy ? "excluded" : "new",
      })),
    });
  // Keep the embeddings computed above so search by meaning doesn't pay for them again.
  if (meaning.vectors.size) {
    try {
      const saved = await db.sourcedProfile.findMany({ where: { runId: run.id }, select: { id: true, source: true, sourceRecordId: true, currentTitle: true, currentCompany: true, location: true, profileText: true, signalsJson: true } });
      const st = embeddingStatus();
      for (const sp of saved) {
        const p = merged.find((m) => m.sourceKey === sp.source && m.sourceRecordId === sp.sourceRecordId);
        const vec = p ? meaning.vectors.get(p) : undefined;
        if (!vec) continue;
        const data = { orgId: auth.orgId, textHash: hashText(sourcedText(sp)), model: st.model, vector: vec };
        await db.embedding.upsert({ where: { kind_refId: { kind: "sourced", refId: sp.id } }, create: { kind: "sourced", refId: sp.id, ...data }, update: data });
      }
    } catch (err) {
      logError("semantic.store_failed", err, { runId: run.id });
    }
  }
  await audit(auth, "discover.searched", {
    subjectType: "sourcing",
    subjectId: run.id,
    roleId,
    meta: { sources: run.source, demo, results: run.resultCount, failed: statuses.filter((s) => s.status !== "ok").length },
  });
  return { anyOk, runId: run.id, statuses, added: fresh.length, found: merged.length };

}

type MeaningOutcome = { status: "off" | "ok" | "failed"; scored: number; model?: string; note?: string };

/**
 * Embeds the role (the recruiter's description, or its fields and approved criteria) and each found
 * person, and returns each person's cosine similarity to the role. At most 250 people per search.
 */
async function meaningFor(orgId: string, roleId: string, f: BriefFields, describedAs: string | null, people: MergedProfile[]): Promise<{ sims: Map<MergedProfile, number>; vectors: Map<MergedProfile, number[]>; outcome: MeaningOutcome }> {
  const sims = new Map<MergedProfile, number>();
  const vectors = new Map<MergedProfile, number[]>();
  const st = embeddingStatus();
  if (!st.configured || !people.length) return { sims, vectors, outcome: { status: "off", scored: 0, note: st.reason ?? undefined } };
  try {
    const criteria = await db.criterion.findMany({ where: { orgId, roleId, status: "approved" }, select: { name: true }, orderBy: { position: "asc" }, take: 30 });
    const roleText = (describedAs?.trim() || [f.roleName, f.altTitles.join(", "), `Skills: ${[...f.skillsRequired, ...f.skillsPreferred].join(", ")}`, ...criteria.map((c) => c.name)].filter(Boolean).join("\n")).slice(0, 4000);
    const batch = people.slice(0, 250);
    const texts = batch.map((p) => sourcedText({ currentTitle: p.currentTitle, currentCompany: p.currentCompany, location: p.location, profileText: p.text ? stripContact(p.text).slice(0, 8000) : null, signalsJson: JSON.stringify(p.signals) }));
    const [roleVec, ...vecs] = await embedTexts([roleText, ...texts]);
    batch.forEach((p, i) => {
      if (texts[i].length < 20) return;
      vectors.set(p, vecs[i]);
      sims.set(p, cosine(roleVec, vecs[i]));
    });
    return { sims, vectors, outcome: { status: "ok", scored: sims.size, model: st.model } };
  } catch (err) {
    logError("semantic.discover_failed", err, { roleId });
    return { sims, vectors, outcome: { status: "failed", scored: 0, note: err instanceof Error ? err.message : "Embeddings failed" } };
  }
}
