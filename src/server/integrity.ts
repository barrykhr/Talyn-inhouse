import "server-only";
import { extractAnswers } from "@/lib/authenticity";
import { db } from "@/lib/db";
import { COPIED_ANSWER_OVERLAP, NEAR_DUPLICATE_BITS, hamming, overlap, simhash } from "@/lib/loop/integrity";

export type IntegrityFindings = {
  nearCvs: { candidateId: string; name: string; bits: number }[];
  copiedAnswers: { candidateId: string; name: string; label: string; overlap: number }[];
  callDifferences: { callId: string; roleId: string; title: string; cv: string; said: string; passage: number | null }[];
};

const pagesText = (json: string) => {
  try {
    return (JSON.parse(json) as string[]).join("\n");
  } catch {
    return "";
  }
};

/** Fills in missing CV fingerprints for a workspace, a batch at a time. */
async function fillSimhashes(orgId: string, limit = 300) {
  const missing = await db.resume.findMany({ where: { orgId, isCurrent: true, simhash: null }, select: { id: true, pagesJson: true }, take: limit });
  for (const r of missing) await db.resume.update({ where: { id: r.id }, data: { simhash: simhash(pagesText(r.pagesJson)) ?? "" } });
}

/**
 * Things worth checking with a person for one candidate. Never a verdict: a shared CV template,
 * a referral who reused wording, or a transcription slip can all explain a finding.
 */
export async function integrityFor(orgId: string, candidateId: string): Promise<IntegrityFindings> {
  await fillSimhashes(orgId);
  const mine = await db.resume.findFirst({ where: { orgId, candidateId, isCurrent: true }, orderBy: { createdAt: "desc" }, select: { simhash: true } });
  const nearCvs: IntegrityFindings["nearCvs"] = [];
  if (mine?.simhash) {
    const others = await db.resume.findMany({ where: { orgId, isCurrent: true, candidateId: { not: candidateId }, simhash: { not: "" } }, select: { simhash: true, candidate: { select: { id: true, fullName: true } } } });
    for (const o of others) {
      if (!o.simhash) continue;
      const bits = hamming(mine.simhash, o.simhash);
      if (bits <= NEAR_DUPLICATE_BITS && !nearCvs.some((n) => n.candidateId === o.candidate.id)) nearCvs.push({ candidateId: o.candidate.id, name: o.candidate.fullName, bits });
    }
  }

  // Answers to the same questions from other candidates in the same roles.
  const me = await db.candidate.findFirst({ where: { id: candidateId, orgId }, select: { candidateSummary: true, applications: { select: { roleId: true } } } });
  const myAnswers = extractAnswers(me?.candidateSummary).filter((a) => a.text.length > 80);
  const copiedAnswers: IntegrityFindings["copiedAnswers"] = [];
  if (myAnswers.length && me?.applications.length) {
    const peers = await db.candidate.findMany({
      where: { orgId, id: { not: candidateId }, applications: { some: { roleId: { in: me.applications.map((a) => a.roleId) } } }, candidateSummary: { not: null } },
      select: { id: true, fullName: true, candidateSummary: true },
      take: 500,
    });
    for (const p of peers)
      for (const theirs of extractAnswers(p.candidateSummary))
        for (const a of myAnswers) {
          const o = overlap(a.text, theirs.text);
          if (o >= COPIED_ANSWER_OVERLAP && !copiedAnswers.some((c) => c.candidateId === p.id && c.label === a.label)) copiedAnswers.push({ candidateId: p.id, name: p.fullName, label: a.label, overlap: Math.round(o * 100) });
        }
  }

  const calls = await db.roleCall.findMany({ where: { orgId, candidateId, analysis: { isNot: null } }, select: { id: true, roleId: true, title: true, analysis: { select: { integrityJson: true } } } });
  const callDifferences = calls.flatMap((c) =>
    (JSON.parse(c.analysis!.integrityJson) as { cv: string; said: string; passage: number | null }[]).map((d) => ({ callId: c.id, roleId: c.roleId ?? "", title: c.title, ...d })),
  );
  return { nearCvs, copiedAnswers, callDifferences };
}
