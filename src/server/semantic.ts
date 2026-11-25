import "server-only";
import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import { candidateText, cosine, evidenceLines, hashText, meaningBand, sourcedText, type MeaningBand } from "@/lib/semantic/core";
import { embedTexts, embeddingStatus } from "@/lib/semantic/embed";

export type SemanticHit = {
  kind: "candidate" | "sourced";
  id: string;
  href: string;
  name: string;
  title: string | null;
  company: string | null;
  location: string | null;
  isSample: boolean;
  context: string; // "In Talyn" or "Found for <role> · GitHub"
  sim: number;
  band: MeaningBand;
  quote: string | null; // the line closest in meaning to the query
};

/** Which Discover list a result sits in, so a link opens the right tab. */
function discoverView(status: string, relevanceJson: string): string {
  if (status === "saved" || status === "dismissed" || status === "excluded") return status;
  try {
    return (JSON.parse(relevanceJson) as { belowBar?: boolean }).belowBar ? "limited" : "review";
  } catch {
    return "review";
  }
}

type Doc = { kind: "candidate" | "sourced"; refId: string; text: string };

async function candidateDocs(orgId: string, ids?: string[]): Promise<Doc[]> {
  const rows = await db.candidate.findMany({
    where: { orgId, ...(ids ? { id: { in: ids } } : {}) },
    orderBy: { updatedAt: "desc" },
    take: ids ? undefined : 2000,
    select: {
      id: true,
      currentTitle: true,
      currentCompany: true,
      location: true,
      candidateSummary: true,
      resumes: { where: { isCurrent: true }, take: 1, select: { pagesJson: true } },
      extracted: { where: { status: { in: ["accepted", "edited"] }, field: "skill" }, take: 40, select: { valueJson: true, editedValueJson: true, status: true } },
    },
  });
  return rows.map((c) => {
    let pages: string[] = [];
    try {
      pages = c.resumes[0] ? (JSON.parse(c.resumes[0].pagesJson) as string[]) : [];
    } catch {
      pages = [];
    }
    const skills = c.extracted
      .map((x) => {
        try {
          return JSON.parse(x.status === "edited" && x.editedValueJson ? x.editedValueJson : x.valueJson) as unknown;
        } catch {
          return null;
        }
      })
      .filter((v): v is string => typeof v === "string");
    return { kind: "candidate" as const, refId: c.id, text: candidateText(c, skills.length ? [`Skills: ${skills.join(", ")}`] : [], pages) };
  });
}

async function sourcedDocs(orgId: string, ids?: string[]): Promise<Doc[]> {
  const rows = await db.sourcedProfile.findMany({
    where: { orgId, ...(ids ? { id: { in: ids } } : { status: { not: "excluded" } }) },
    orderBy: { createdAt: "desc" },
    take: ids ? undefined : 3000,
    select: { id: true, currentTitle: true, currentCompany: true, location: true, profileText: true, signalsJson: true },
  });
  return rows.map((p) => ({ kind: "sourced" as const, refId: p.id, text: sourcedText(p) }));
}

/**
 * Embeds people whose text is new or changed, up to `limit`. Returns how many were embedded and how
 * many are still waiting. Safe to call often: unchanged people cost nothing.
 */
export async function indexPending(orgId: string, limit = 200, only?: { kind: "candidate" | "sourced"; ids: string[] }): Promise<{ embedded: number; pending: number }> {
  const st = embeddingStatus();
  if (!st.configured) return { embedded: 0, pending: 0 };
  const docs = only ? (only.kind === "candidate" ? await candidateDocs(orgId, only.ids) : await sourcedDocs(orgId, only.ids)) : [...(await candidateDocs(orgId)), ...(await sourcedDocs(orgId))];
  const existing = await db.embedding.findMany({ where: { orgId, refId: { in: docs.map((d) => d.refId) } }, select: { kind: true, refId: true, textHash: true, model: true } });
  const have = new Map(existing.map((e) => [`${e.kind}|${e.refId}`, e]));
  const todo = docs.filter((d) => {
    if (d.text.length < 20) return false;
    const e = have.get(`${d.kind}|${d.refId}`);
    return !e || e.textHash !== hashText(d.text) || e.model !== st.model;
  });
  const batch = todo.slice(0, limit);
  if (!batch.length) return { embedded: 0, pending: 0 };
  const vectors = await embedTexts(batch.map((d) => d.text));
  for (const [i, d] of batch.entries()) {
    const data = { orgId, textHash: hashText(d.text), model: st.model, vector: vectors[i] };
    await db.embedding.upsert({ where: { kind_refId: { kind: d.kind, refId: d.refId } }, create: { kind: d.kind, refId: d.refId, ...data }, update: data });
  }
  return { embedded: batch.length, pending: todo.length - batch.length };
}

/** Nearest people by cosine similarity (vectors are unit length, so the dot product), computed in SQL. */
async function nearest(orgId: string, vector: number[], opts: { kinds: ("candidate" | "sourced")[]; exclude?: string; limit: number }) {
  const st = embeddingStatus();
  const rows = await db.$queryRaw<{ kind: string; refId: string; score: number }[]>`
    SELECT e."kind", e."refId",
           (SELECT SUM(a * b) FROM unnest(e."vector", ${vector}::float8[]) AS t(a, b)) AS score
    FROM "Embedding" e
    WHERE e."orgId" = ${orgId} AND e."model" = ${st.model} AND e."kind" = ANY(${opts.kinds}::text[]) AND e."refId" <> ${opts.exclude ?? ""}
    ORDER BY score DESC NULLS LAST
    LIMIT ${opts.limit}`;
  return rows.map((r) => ({ kind: r.kind as "candidate" | "sourced", refId: r.refId, score: Number(r.score) }));
}

async function hydrate(orgId: string, hits: { kind: "candidate" | "sourced"; refId: string; score: number }[], self?: { candidateIds: Set<string>; sourceKeys: Set<string> }): Promise<SemanticHit[]> {
  const cIds = hits.filter((h) => h.kind === "candidate").map((h) => h.refId);
  const sIds = hits.filter((h) => h.kind === "sourced").map((h) => h.refId);
  const [cands, sourced] = await Promise.all([
    db.candidate.findMany({ where: { orgId, id: { in: cIds } }, select: { id: true, fullName: true, currentTitle: true, currentCompany: true, location: true, isSample: true, contactOptOut: true } }),
    db.sourcedProfile.findMany({
      where: { orgId, id: { in: sIds } },
      select: { id: true, roleId: true, runId: true, status: true, relevanceJson: true, displayName: true, currentTitle: true, currentCompany: true, location: true, source: true, sourceRecordId: true, duplicateCandidateId: true },
    }),
  ]);
  const roles = new Map((await db.role.findMany({ where: { orgId, id: { in: [...new Set(sourced.map((x) => x.roleId))] } }, select: { id: true, title: true } })).map((r) => [r.id, r.title]));
  const out: SemanticHit[] = [];
  const seen = new Set<string>();
  for (const h of hits) {
    if (h.kind === "candidate") {
      const c = cands.find((x) => x.id === h.refId);
      if (!c || seen.has(`c|${c.id}`) || self?.candidateIds.has(c.id)) continue;
      seen.add(`c|${c.id}`);
      out.push({ kind: "candidate", id: c.id, href: `/candidates/${c.id}`, name: c.fullName, title: c.currentTitle, company: c.currentCompany, location: c.location, isSample: c.isSample, context: "In your candidates", sim: h.score, band: meaningBand(h.score), quote: null });
    } else {
      const s = sourced.find((x) => x.id === h.refId);
      // The same person found for several roles, or already a candidate, appears once.
      if (!s || seen.has(`s|${s.source}|${s.sourceRecordId}`) || (s.duplicateCandidateId && seen.has(`c|${s.duplicateCandidateId}`))) continue;
      // "People like X" never lists X again under another record.
      if (self && (self.sourceKeys.has(`${s.source}|${s.sourceRecordId}`) || (s.duplicateCandidateId && self.candidateIds.has(s.duplicateCandidateId)) || (s.source === "talyn" && self.candidateIds.has(s.sourceRecordId)))) continue;
      seen.add(`s|${s.source}|${s.sourceRecordId}`);
      out.push({ kind: "sourced", id: s.id, href: `/roles/${s.roleId}/discover?run=${s.runId}&view=${discoverView(s.status, s.relevanceJson)}#p-${s.id}`, name: s.displayName, title: s.currentTitle, company: s.currentCompany, location: s.location, isSample: s.source === "sample", context: `Found in Discover for ${roles.get(s.roleId) ?? "a role"}`, sim: h.score, band: meaningBand(h.score), quote: null });
    }
  }
  return out;
}

/** For the top results, the line from each person's text that is closest in meaning to the query. */
async function addEvidence(orgId: string, hits: SemanticHit[], queryVec: number[], top = 15): Promise<void> {
  const first = hits.slice(0, top);
  const docs = new Map(
    [...(await candidateDocs(orgId, first.filter((h) => h.kind === "candidate").map((h) => h.id))), ...(await sourcedDocs(orgId, first.filter((h) => h.kind === "sourced").map((h) => h.id)))].map((d) => [`${d.kind}|${d.refId}`, d.text]),
  );
  const lines = first.map((h) => evidenceLines(docs.get(`${h.kind}|${h.id}`) ?? "", 20));
  const flat = lines.flat();
  if (!flat.length) return;
  const vecs = await embedTexts(flat);
  let k = 0;
  for (const [i, ls] of lines.entries()) {
    let best: { line: string; s: number } | null = null;
    for (const l of ls) {
      const s = cosine(queryVec, vecs[k++]);
      if (!best || s > best.s) best = { line: l, s };
    }
    first[i].quote = best?.line ?? null;
  }
}

export type SemanticResult = { hits: SemanticHit[]; indexed: { embedded: number; pending: number }; model: string; fake: boolean; error?: string };

/** Plain-English search across candidates and Discover results. Ordering only; nobody is filtered out by meaning. */
export async function searchByMeaning(orgId: string, query: string, opts: { kinds?: ("candidate" | "sourced")[]; limit?: number } = {}): Promise<SemanticResult> {
  const st = embeddingStatus();
  if (!st.configured) return { hits: [], indexed: { embedded: 0, pending: 0 }, model: st.model, fake: false, error: st.reason ?? "Search by meaning isn't set up." };
  try {
    const indexed = await indexPending(orgId, 150);
    const [qv] = await embedTexts([query]);
    const near = await nearest(orgId, qv, { kinds: opts.kinds ?? ["candidate", "sourced"], limit: (opts.limit ?? 30) * 2 });
    const hits = (await hydrate(orgId, near)).slice(0, opts.limit ?? 30);
    await addEvidence(orgId, hits, qv);
    return { hits, indexed, model: st.model, fake: st.fake };
  } catch (err) {
    logError("semantic.search_failed", err);
    return { hits: [], indexed: { embedded: 0, pending: 0 }, model: st.model, fake: st.fake, error: err instanceof Error ? err.message : "Search by meaning failed. Try again." };
  }
}

/** People closest in meaning to one candidate or Discover result. */
export async function similarTo(orgId: string, kind: "candidate" | "sourced", refId: string, opts: { kinds?: ("candidate" | "sourced")[]; limit?: number } = {}): Promise<SemanticResult & { name: string | null }> {
  const st = embeddingStatus();
  if (!st.configured) return { hits: [], indexed: { embedded: 0, pending: 0 }, model: st.model, fake: false, name: null, error: st.reason ?? "Search by meaning isn't set up." };
  try {
    await indexPending(orgId, 50, { kind, ids: [refId] });
    const indexed = await indexPending(orgId, 150);
    const me = await db.embedding.findUnique({ where: { kind_refId: { kind, refId } } });
    const name = kind === "candidate" ? (await db.candidate.findFirst({ where: { id: refId, orgId }, select: { fullName: true } }))?.fullName ?? null : (await db.sourcedProfile.findFirst({ where: { id: refId, orgId }, select: { displayName: true } }))?.displayName ?? null;
    if (!me || me.orgId !== orgId) return { hits: [], indexed, model: st.model, fake: st.fake, name, error: "This person has too little work-related text to compare with." };
    const near = await nearest(orgId, me.vector, { kinds: opts.kinds ?? ["candidate", "sourced"], exclude: refId, limit: (opts.limit ?? 30) * 2 + 10 });
    const hits = (await hydrate(orgId, near, await selfOf(orgId, kind, refId))).slice(0, opts.limit ?? 30);
    await addEvidence(orgId, hits, me.vector);
    return { hits, indexed, model: st.model, fake: st.fake, name };
  } catch (err) {
    logError("semantic.similar_failed", err);
    return { hits: [], indexed: { embedded: 0, pending: 0 }, model: st.model, fake: st.fake, name: null, error: err instanceof Error ? err.message : "Search by meaning failed. Try again." };
  }
}

/** Daily: keep each workspace's search-by-meaning index current (new CVs, new Discover results). */
export async function refreshSearchIndex(): Promise<{ orgs: number; embedded: number; failed: number }> {
  if (!embeddingStatus().configured) return { orgs: 0, embedded: 0, failed: 0 };
  const orgs = await db.organization.findMany({ select: { id: true } });
  let embedded = 0, failed = 0;
  for (const o of orgs) {
    try {
      embedded += (await indexPending(o.id, 400)).embedded;
    } catch (err) {
      failed++;
      logError("semantic.index_failed", err, { orgId: o.id });
    }
  }
  return { orgs: orgs.length, embedded, failed };
}

/** Every record that is this same person: the candidate, their Discover records, and the candidate a record was saved as. */
async function selfOf(orgId: string, kind: "candidate" | "sourced", refId: string): Promise<{ candidateIds: Set<string>; sourceKeys: Set<string> }> {
  const candidateIds = new Set<string>();
  const sourceKeys = new Set<string>();
  if (kind === "candidate") {
    candidateIds.add(refId);
    const apps = await db.application.findMany({ where: { orgId, candidateId: refId, sourcedProfileId: { not: null } }, select: { sourcedProfileId: true } });
    const linked = await db.sourcedProfile.findMany({
      where: { orgId, OR: [{ id: { in: apps.map((a) => a.sourcedProfileId!) } }, { duplicateCandidateId: refId }, { source: "talyn", sourceRecordId: refId }] },
      select: { source: true, sourceRecordId: true },
    });
    for (const l of linked) sourceKeys.add(`${l.source}|${l.sourceRecordId}`);
    // Records flagged as possible duplicates of this candidate are the same person too.
    const dups = await db.duplicateReview.findMany({ where: { orgId, status: { not: "dismissed" }, OR: [{ candidateAId: refId }, { candidateBId: refId }] }, select: { candidateAId: true, candidateBId: true } });
    for (const d of dups) {
      candidateIds.add(d.candidateAId);
      candidateIds.add(d.candidateBId);
    }
  } else {
    const sp = await db.sourcedProfile.findFirst({ where: { orgId, id: refId }, select: { source: true, sourceRecordId: true, duplicateCandidateId: true } });
    if (sp) {
      sourceKeys.add(`${sp.source}|${sp.sourceRecordId}`);
      if (sp.duplicateCandidateId) candidateIds.add(sp.duplicateCandidateId);
      if (sp.source === "talyn") candidateIds.add(sp.sourceRecordId);
      const copies = await db.sourcedProfile.findMany({ where: { orgId, source: sp.source, sourceRecordId: sp.sourceRecordId }, select: { id: true } });
      const saved = await db.application.findMany({ where: { orgId, sourcedProfileId: { in: copies.map((c) => c.id) } }, select: { candidateId: true } });
      for (const a of saved) candidateIds.add(a.candidateId);
    }
  }
  return { candidateIds, sourceKeys };
}
