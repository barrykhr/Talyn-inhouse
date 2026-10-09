"use server";

import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { briefFields } from "@/lib/discovery/store";
import { findSkillMentions, skillTerms } from "@/lib/heuristics";
import { CONNECTORS } from "@/lib/sourcing/connectors";
import { profileEvidenceText } from "@/lib/skills";
import { ownRole } from "./scope";

export type PoolEstimate = {
  ok: true;
  computedAt: string;
  population: number; // real candidates in the workspace with text to check
  withoutText: number; // real candidates with no CV or profile text (can't be checked)
  capped: boolean;
  mustHave: string[];
  matchAll: number;
  perSkill: { skill: string; have: number; ifPreferred: number }[]; // ifPreferred = matches when this skill is not required
  location: { value: string; matching: number } | null;
  matchAllInLocation: number | null;
  oldestCv: string | null;
  newestCv: string | null;
  sources: { label: string; included: boolean; why: string }[];
  limitations: string[];
};

const CAP = 3000;

/**
 * Estimates how many people in the workspace's own candidate database show the role's must-have
 * skills, from text they actually contain (CV, candidate-provided information). Uses the saved
 * Discover search fields. External sources are never counted here: no connected provider offers a
 * count before a search, so none is claimed.
 */
export async function estimatePool(roleId: string): Promise<PoolEstimate | { ok: false; error: string }> {
  const auth = await requireAuth();
  await ownRole(auth, roleId);
  const brief = await db.discoveryBrief.findUnique({ where: { roleId } });
  const f = briefFields(brief);
  if (!brief || !f.skillsRequired.length) return { ok: false, error: "Save the search setup with at least one required skill first." };
  const aliases = await db.criterion.findMany({ where: { orgId: auth.orgId, roleId, kind: "skill", status: "approved" }, select: { name: true, aliases: true } });
  const aliasFor = (s: string) => aliases.find((a) => a.name.toLowerCase() === s.toLowerCase())?.aliases ?? "";

  const cands = await db.candidate.findMany({
    where: { orgId: auth.orgId, isSample: false },
    select: { currentTitle: true, currentCompany: true, candidateSummary: true, location: true, resumes: { where: { isCurrent: true }, select: { pagesJson: true, createdAt: true }, take: 1 } },
    orderBy: { updatedAt: "desc" },
    take: CAP + 1,
  });
  const capped = cands.length > CAP;
  const rows = cands.slice(0, CAP).map((c) => {
    let cv = "";
    try {
      cv = c.resumes[0] ? (JSON.parse(c.resumes[0].pagesJson) as string[]).join("\n") : "";
    } catch {
      cv = "";
    }
    return { text: `${cv}\n${profileEvidenceText(c)}`.trim(), location: c.location ?? "", cvAt: c.resumes[0]?.createdAt ?? null };
  });
  const checkable = rows.filter((r) => r.text.length > 0);
  const terms = f.skillsRequired.map((s) => skillTerms(s, aliasFor(s)));
  const has = checkable.map((r) => terms.map((t) => findSkillMentions(t, r.text).length > 0));
  const all = (row: boolean[], skip = -1) => row.every((v, i) => i === skip || v);
  const loc = f.location && f.workArrangement !== "remote" ? f.location.split(",")[0].trim().toLowerCase() : "";
  const inLoc = checkable.map((r) => !!loc && r.location.toLowerCase().includes(loc));
  const dates = checkable.map((r) => r.cvAt).filter((d): d is Date => !!d).sort((a, b) => a.getTime() - b.getTime());
  const external = CONNECTORS.filter((c) => c.kind === "external");

  return {
    ok: true,
    computedAt: new Date().toISOString(),
    population: checkable.length,
    withoutText: rows.length - checkable.length,
    capped,
    mustHave: f.skillsRequired,
    matchAll: has.filter((h) => all(h)).length,
    perSkill: f.skillsRequired.map((skill, i) => ({ skill, have: has.filter((h) => h[i]).length, ifPreferred: has.filter((h) => all(h, i)).length })),
    location: loc ? { value: f.location!, matching: inLoc.filter(Boolean).length } : null,
    matchAllInLocation: loc ? has.filter((h, i) => all(h) && inLoc[i]).length : null,
    oldestCv: dates[0]?.toISOString() ?? null,
    newestCv: dates[dates.length - 1]?.toISOString() ?? null,
    sources: [
      { label: "Talyn candidate database", included: true, why: "Your workspace's own candidates (fictional sample people excluded)." },
      ...external.map((c) => ({
        label: c.label,
        included: false,
        why: c.configured() ? "Connected, but it doesn't provide a count before a search. A count appears with search results only if the provider returns one." : "Not connected.",
      })),
    ],
    limitations: [
      "A skill counts when its name (or an alias set on the role's Criteria tab) appears as a whole word in the CV or candidate-provided information. Synonyms you haven't listed are missed, and a mention doesn't show depth.",
      "Years of experience aren't applied: they can't be read reliably from free text.",
      loc ? "Location matches the candidate's recorded location text only." : "No location filter (none set, or the role is remote).",
      "This is an estimate of people already in Talyn, not of the market, and not a prediction of who is interested.",
    ],
  };
}
