// Transparent assessment summary: counts per importance and result. No weighted score.
export type SummaryItem = { importance: string; result: string; overrideResult: string | null };

export type Summary = {
  essential: { total: number; supported: number; inferred: number; not_stated: number };
  preferred: { total: number; supported: number; inferred: number; not_stated: number };
  overrides: number;
};

export function summarize(items: SummaryItem[]): Summary {
  const blank = () => ({ total: 0, supported: 0, inferred: 0, not_stated: 0 });
  const s: Summary = { essential: blank(), preferred: blank(), overrides: 0 };
  for (const i of items) {
    const bucket = i.importance === "preferred" ? s.preferred : s.essential;
    const r = (i.overrideResult ?? i.result) as "supported" | "inferred" | "not_stated";
    bucket.total++;
    if (r in bucket) bucket[r]++;
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
