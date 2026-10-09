import "server-only";
import { db } from "./db";

// Possible-duplicate detection across a workspace's candidates. Suggestions only: nothing is merged,
// moved or deleted. Exact identifiers (email, phone, profile URL) are high confidence; name plus
// company is medium; a name alone is low confidence and labelled uncertain.

export const normEmail = (v: string | null | undefined) => (v ? v.trim().toLowerCase() : "");
export const normPhone = (v: string | null | undefined) => {
  const d = (v ?? "").replace(/\D/g, "");
  return d.length >= 8 ? d.slice(-10) : ""; // last 10 digits: ignores country code formatting differences
};
export const normUrl = (v: string | null | undefined) =>
  (v ?? "")
    .trim()
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/[?#].*$/, "")
    .replace(/\/+$/, "");
export const normName = (v: string | null | undefined) =>
  (v ?? "")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

type Cand = { id: string; fullName: string; email: string | null; phone: string | null; linkedinUrl: string | null; currentCompany: string | null };
export type Pair = { a: string; b: string; reasons: string[]; confidence: "high" | "medium" | "low" };

export function findPairs(cands: Cand[]): Pair[] {
  const pairs = new Map<string, Pair>();
  const rank = { low: 0, medium: 1, high: 2 } as const;
  const add = (x: string, y: string, reason: string, confidence: Pair["confidence"]) => {
    if (x === y) return;
    const [a, b] = x < y ? [x, y] : [y, x];
    const key = `${a}:${b}`;
    const p = pairs.get(key) ?? { a, b, reasons: [], confidence };
    if (!p.reasons.includes(reason)) p.reasons.push(reason);
    if (rank[confidence] > rank[p.confidence]) p.confidence = confidence;
    pairs.set(key, p);
  };
  const index = (key: (c: Cand) => string, reason: string, confidence: Pair["confidence"]) => {
    const m = new Map<string, string[]>();
    for (const c of cands) {
      const k = key(c);
      if (k) m.set(k, [...(m.get(k) ?? []), c.id]);
    }
    for (const ids of m.values()) {
      if (ids.length < 2 || ids.length > 20) continue; // a value shared by many records is not an identifier
      for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) add(ids[i], ids[j], reason, confidence);
    }
  };
  index((c) => normEmail(c.email), "Same email address", "high");
  index((c) => normPhone(c.phone), "Same phone number (last 10 digits)", "high");
  index((c) => normUrl(c.linkedinUrl), "Same profile URL", "high");
  index((c) => (normName(c.fullName) && normName(c.currentCompany) ? `${normName(c.fullName)}|${normName(c.currentCompany)}` : ""), "Same name and current company", "medium");
  index((c) => (normName(c.fullName).split(" ").length >= 2 ? normName(c.fullName) : ""), "Same name only — uncertain", "low");
  return [...pairs.values()];
}

/** Records new possible-duplicate pairs for review. Existing reviews (and their decisions) are kept; reasons are refreshed. */
export async function scanDuplicates(orgId: string) {
  const cands = await db.candidate.findMany({
    where: { orgId, isSample: false },
    select: { id: true, fullName: true, email: true, phone: true, linkedinUrl: true, currentCompany: true },
    take: 10000,
  });
  const pairs = findPairs(cands);
  if (!pairs.length) return 0;
  const existing = await db.duplicateReview.findMany({ where: { orgId }, select: { id: true, candidateAId: true, candidateBId: true, reasonsJson: true, confidence: true } });
  const byKey = new Map(existing.map((e) => [`${e.candidateAId}:${e.candidateBId}`, e]));
  const creates = [];
  for (const p of pairs) {
    const e = byKey.get(`${p.a}:${p.b}`);
    if (!e) creates.push({ orgId, candidateAId: p.a, candidateBId: p.b, reasonsJson: JSON.stringify(p.reasons), confidence: p.confidence });
    else if (e.reasonsJson !== JSON.stringify(p.reasons) || e.confidence !== p.confidence)
      await db.duplicateReview.update({ where: { id: e.id }, data: { reasonsJson: JSON.stringify(p.reasons), confidence: p.confidence } });
  }
  if (creates.length) await db.duplicateReview.createMany({ data: creates, skipDuplicates: true });
  return creates.length;
}

export const CONFIDENCE_LABEL: Record<string, string> = { high: "High — shared identifier", medium: "Medium — name and company", low: "Low — name only (uncertain)" };
export const DUP_STATUS_LABEL: Record<string, string> = { open: "To review", linked: "Confirmed same person (linked)", dismissed: "Dismissed — different people", deferred: "Deferred" };
