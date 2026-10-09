import type { RawProfile, Signal } from "./connectors";

export type FoundIn = { key: string; label: string; url: string | null; recordId: string; retrievedAt: string };
export type MergedProfile = RawProfile & { sourceKey: string; sources: FoundIn[] };

const norm = (s: string | null | undefined) => (s ?? "").toLowerCase().normalize("NFKD").replace(/[^\p{L}\p{N}]+/gu, " ").trim();

function identityKeys(sourceKey: string, p: RawProfile): string[] {
  const keys: string[] = [];
  if (sourceKey === "talyn") keys.push(`cand:${p.sourceRecordId}`);
  if (p.duplicateCandidateId) keys.push(`cand:${p.duplicateCandidateId}`);
  const email = p.fields.email?.value;
  if (email) keys.push(`email:${email.toLowerCase()}`);
  const li = p.fields.linkedin_url?.value;
  if (li) keys.push(`li:${li.toLowerCase().replace(/^https?:\/\/(www\.)?/, "").replace(/\/+$/, "")}`);
  if (p.currentCompany && norm(p.displayName)) keys.push(`nc:${norm(p.displayName)}|${norm(p.currentCompany)}`);
  return keys;
}

/**
 * Deduplicates people found in several sources. Matches only on strong identifiers (Talyn record,
 * email, LinkedIn URL) or the same name AND company — never name alone. Each merged person keeps
 * every source link and the source of each quoted piece of evidence.
 */
export function mergeAcrossSources(batches: { key: string; label: string; retrievedAt: string; profiles: RawProfile[] }[]): MergedProfile[] {
  const items = batches.flatMap((b) => b.profiles.map((p) => ({ b, p, signals: p.signals.map((s): Signal => ({ ...s, source: b.label })) })));
  // Union-find over shared identity keys.
  const parent = items.map((_, i) => i);
  const find = (i: number): number => (parent[i] === i ? i : (parent[i] = find(parent[i])));
  const owner = new Map<string, number>();
  items.forEach((it, i) => {
    for (const k of identityKeys(it.b.key, it.p)) {
      const j = owner.get(k);
      if (j === undefined) owner.set(k, i);
      else parent[find(i)] = find(j);
    }
  });
  const groups = new Map<number, typeof items>();
  items.forEach((it, i) => groups.set(find(i), [...(groups.get(find(i)) ?? []), it]));

  return [...groups.values()].map((g) => {
    const matched = (x: (typeof g)[number]) => x.signals.filter((s) => s.matched).length;
    const primary = [...g].sort((a, b) => matched(b) - matched(a) || (a.b.key === "talyn" ? -1 : 1))[0];
    // Per search term, keep the best evidence across sources (a matched quote wins).
    const byTerm = new Map<string, Signal>();
    for (const it of g)
      for (const s of it.signals) {
        const k = `${s.category}|${s.term.toLowerCase()}`;
        const cur = byTerm.get(k);
        if (!cur || (!cur.matched && s.matched) || (s.matched && !cur.quote && s.quote)) byTerm.set(k, s);
      }
    const fields = { ...Object.assign({}, ...[...g].reverse().map((it) => it.p.fields)), ...primary.p.fields };
    const ok = g.find((it) => it.p.evidenceStatus === "ok");
    const talyn = g.find((it) => it.b.key === "talyn");
    return {
      ...primary.p,
      sourceKey: primary.b.key,
      fields,
      signals: primary.signals.map((s) => byTerm.get(`${s.category}|${s.term.toLowerCase()}`) ?? s),
      evidenceStatus: ok ? "ok" : primary.p.evidenceStatus,
      staleReason: ok ? ok.p.staleReason : primary.p.staleReason,
      excludedBy: g.find((it) => it.p.excludedBy)?.p.excludedBy ?? null,
      duplicateCandidateId: talyn ? talyn.p.sourceRecordId : (g.find((it) => it.p.duplicateCandidateId)?.p.duplicateCandidateId ?? null),
      duplicateReason: talyn && primary.b.key !== "talyn" ? "Already in Talyn" : (primary.p.duplicateReason ?? g.find((it) => it.p.duplicateReason)?.p.duplicateReason ?? null),
      sources: g.map((it) => ({ key: it.b.key, label: it.b.label, url: it.p.sourceUrl, recordId: it.p.sourceRecordId, retrievedAt: it.b.retrievedAt })),
    };
  });
}
