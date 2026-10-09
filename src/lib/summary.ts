// Transparent assessment summary: counts per importance and result (recruiter corrections applied).
export type SummaryItem = { importance: string; result: string; overrideResult: string | null; kind?: string };

type Bucket = { total: number; supported: number; partially_supported: number; inferred: number; conflicting: number; not_stated: number; confirmed_absent: number };
export type Summary = { essential: Bucket; preferred: Bucket; overrides: number };

export function summarize(items: SummaryItem[]): Summary {
  const blank = (): Bucket => ({ total: 0, supported: 0, partially_supported: 0, inferred: 0, conflicting: 0, not_stated: 0, confirmed_absent: 0 });
  const s: Summary = { essential: blank(), preferred: blank(), overrides: 0 };
  // Evaluation criteria only: skills are counted separately (src/lib/skills.ts); informational criteria aren't weighted.
  for (const i of items) {
    if (i.kind === "skill" || i.importance === "informational") continue;
    const bucket = i.importance === "preferred" ? s.preferred : s.essential;
    const r = (i.overrideResult ?? i.result) as keyof Bucket;
    bucket.total++;
    if (r !== "total" && r in bucket) bucket[r]++;
    if (i.overrideResult) s.overrides++;
  }
  return s;
}

/** Whether the approved criteria changed since an assessment was generated. */
export function isStale(snapshotJson: string, current: { id: string; updatedAt: Date }[]): boolean {
  try {
    const snap = JSON.parse(snapshotJson) as { id: string; updatedAt: string }[];
    if (snap.length !== current.length) return true;
    const m = new Map(snap.map((s) => [s.id, s.updatedAt]));
    return current.some((c) => m.get(c.id) !== c.updatedAt.toISOString());
  } catch {
    return true;
  }
}
