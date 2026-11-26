import "server-only";
import { db } from "@/lib/db";
import { embeddingStatus } from "@/lib/semantic/embed";
import { isSilver, silverDepth, silverReason, type PastApp } from "@/lib/loop/past";
import { searchByMeaning } from "./semantic";

export type PastCandidate = { candidateId: string; name: string; headline: string; reasons: string[]; similarity: number | null };

/**
 * People who got far for another role (shortlisted, reached the hiring team, or a hold/advance
 * team decision) and weren't hired, who aren't in this role yet and haven't opted out. Ordered by
 * meaning match to this role when search by meaning is on, else by how far they got.
 */
export async function pastCandidatesFor(orgId: string, role: { id: string; title: string; description: string }, criteria: string[], limit = 8): Promise<PastCandidate[]> {
  const apps = await db.application.findMany({
    where: { orgId, roleId: { not: role.id }, candidate: { contactOptOut: false, isSample: false, applications: { none: { roleId: role.id } } } },
    select: {
      candidateId: true,
      decision: true,
      updatedAt: true,
      role: { select: { title: true } },
      stageEvents: { select: { toStage: true } },
      interviewKit: { select: { decision: true } },
      candidate: { select: { fullName: true, currentTitle: true, currentCompany: true, applications: { where: { stage: "hired" }, select: { id: true } } } },
    },
    take: 2000,
  });
  const by = new Map<string, { name: string; headline: string; past: PastApp[] }>();
  for (const a of apps) {
    if (a.candidate.applications.length) continue; // hired somewhere: not a past candidate
    const past: PastApp = { roleTitle: a.role.title, stagesReached: a.stageEvents.map((e) => e.toStage), decision: a.decision, kitDecision: a.interviewKit?.decision ?? null, at: a.updatedAt };
    if (!isSilver(past)) continue;
    const cur = by.get(a.candidateId) ?? { name: a.candidate.fullName, headline: [a.candidate.currentTitle, a.candidate.currentCompany].filter(Boolean).join(" · "), past: [] };
    cur.past.push(past);
    by.set(a.candidateId, cur);
  }
  if (!by.size) return [];
  let sim = new Map<string, number>();
  if (embeddingStatus().configured) {
    const r = await searchByMeaning(orgId, [role.title, ...criteria].join(". "), { kinds: ["candidate"], limit: 200 });
    if (!r.error) sim = new Map(r.hits.filter((h) => by.has(h.id)).map((h) => [h.id, h.sim]));
  }
  return [...by.entries()]
    .map(([candidateId, v]) => ({ candidateId, name: v.name, headline: v.headline, reasons: v.past.map(silverReason), similarity: sim.get(candidateId) ?? null, depth: Math.max(...v.past.map(silverDepth)) }))
    .sort((a, b) => (b.similarity ?? -1) - (a.similarity ?? -1) || b.depth - a.depth)
    .slice(0, limit)
    .map(({ depth: _d, ...rest }) => rest);
}
