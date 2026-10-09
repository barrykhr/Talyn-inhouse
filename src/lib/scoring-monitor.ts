import "server-only";
import { db } from "./db";
import { parseBands } from "./profile-score";

// Admin monitoring of role scoring, by role and scoring version. Descriptive statistics only:
// they can't prove a process is fair, valid or lawful, and they don't change scoring.

export const MIN_N = 5; // minimum denominator for a rate
export const MIN_GROUP = 10; // minimum group size for any demographic comparison
const IMPACT_RATIO = 0.8; // "four-fifths" screening heuristic — a prompt to review, not a legal test
const ACCURACY_GAP = 0.15; // correction-rate difference between groups that prompts review

type Outcome = { n: number; shortlisted: number; interviewed: number; hired: number };

export async function scoringMonitor(orgId: string, opts: { demographics: boolean }) {
  const [versions, scores] = await Promise.all([
    db.scoringVersion.findMany({ where: { orgId }, orderBy: [{ roleId: "asc" }, { version: "desc" }], include: { role: { select: { title: true } } } }),
    db.profileScore.findMany({
      where: { orgId },
      orderBy: { createdAt: "desc" },
      select: {
        applicationId: true,
        scoringVersionId: true,
        status: true,
        score: true,
        band: true,
        assessmentId: true,
        application: { select: { candidateId: true, decision: true, stage: true, candidate: { select: { isSample: true } }, interviewKit: { select: { status: true } } } },
      },
      take: 50000,
    }),
  ]);
  // Latest score per application per version, real candidates only.
  const seen = new Set<string>();
  const latest = scores.filter((s) => {
    const k = `${s.scoringVersionId}:${s.applicationId}`;
    if (seen.has(k) || s.application.candidate.isSample) return false;
    seen.add(k);
    return true;
  });
  const assessmentIds = [...new Set(latest.map((s) => s.assessmentId))];
  const [items, corrected] = await Promise.all([
    db.assessmentItem.groupBy({ by: ["assessmentId"], where: { assessmentId: { in: assessmentIds } }, _count: true }),
    db.assessmentItem.groupBy({ by: ["assessmentId"], where: { assessmentId: { in: assessmentIds }, corrections: { some: {} } }, _count: true }),
  ]);
  const itemCount = new Map(items.map((i) => [i.assessmentId, i._count]));
  const corrCount = new Map(corrected.map((i) => [i.assessmentId, i._count]));

  const demo = opts.demographics
    ? await db.demographicRecord.findMany({ where: { orgId, candidateId: { in: [...new Set(latest.map((s) => s.application.candidateId))] } }, select: { candidateId: true, category: true, value: true } })
    : [];

  const out = [];
  for (const v of versions) {
    const rows = latest.filter((s) => s.scoringVersionId === v.id);
    const ok = rows.filter((s) => s.status === "ok" && s.score !== null);
    const outcome = (xs: typeof rows): Outcome => ({
      n: xs.length,
      shortlisted: xs.filter((s) => s.application.decision === "advance").length,
      interviewed: xs.filter((s) => s.application.interviewKit?.status === "shared").length,
      hired: xs.filter((s) => s.application.stage === "hired").length,
    });
    const bands = parseBands(v.bandsJson);
    const byBand = bands.map((b) => ({ label: b.label, key: b.key, ...outcome(ok.filter((s) => s.band === b.key)) }));
    const buckets = Array.from({ length: 10 }, (_, i) => ({ from: i * 10, n: ok.filter((s) => Math.min(9, Math.floor((s.score ?? 0) / 10)) === i).length }));
    const items = rows.reduce((n, s) => n + (itemCount.get(s.assessmentId) ?? 0), 0);
    const corr = rows.reduce((n, s) => n + (corrCount.get(s.assessmentId) ?? 0), 0);
    // Do higher bands go with better documented outcomes? Only judged when each band has enough data.
    const enough = byBand.every((b) => b.n >= MIN_N);
    const shortRates = byBand.map((b) => (b.n ? b.shortlisted / b.n : 0));
    const monotonic = enough ? shortRates.every((r, i) => i === 0 || r >= shortRates[i - 1]) : null;

    // Group comparisons, only on self-reported data, only for groups ≥ MIN_GROUP.
    const groups: { category: string; rows: { value: string; n: number; passRate: number | null; shortRate: number | null; corrRate: number | null; suppressed: boolean }[]; flags: string[] }[] = [];
    if (opts.demographics) {
      const cats = [...new Set(demo.map((d) => d.category))];
      for (const cat of cats) {
        const valueOf = new Map(demo.filter((d) => d.category === cat).map((d) => [d.candidateId, d.value]));
        const vals = [...new Set(valueOf.values())];
        const gRows = vals.map((val) => {
          const g = rows.filter((s) => valueOf.get(s.application.candidateId) === val);
          const gOk = g.filter((s) => s.status === "ok");
          const gItems = g.reduce((n, s) => n + (itemCount.get(s.assessmentId) ?? 0), 0);
          const gCorr = g.reduce((n, s) => n + (corrCount.get(s.assessmentId) ?? 0), 0);
          const suppressed = g.length < MIN_GROUP;
          return {
            value: suppressed ? "Small group (suppressed)" : val,
            n: g.length,
            passRate: suppressed || !gOk.length ? null : gOk.filter((s) => s.band === "green").length / gOk.length,
            shortRate: suppressed ? null : g.filter((s) => s.application.decision === "advance").length / g.length,
            corrRate: suppressed || !gItems ? null : gCorr / gItems,
            suppressed,
          };
        });
        const shown = gRows.filter((r) => !r.suppressed);
        const flags: string[] = [];
        for (const metric of ["passRate", "shortRate"] as const) {
          const rates = shown.map((r) => r[metric]).filter((x): x is number => x !== null);
          const max = Math.max(0, ...rates);
          if (shown.length >= 2 && max > 0 && rates.some((r) => r / max < IMPACT_RATIO))
            flags.push(`${metric === "passRate" ? "AI Screen Pass" : "Shortlist"} rate for at least one ${cat} group is under ${IMPACT_RATIO * 100}% of the highest group's rate`);
        }
        const corrRates = shown.map((r) => r.corrRate).filter((x): x is number => x !== null);
        if (corrRates.length >= 2 && Math.max(...corrRates) - Math.min(...corrRates) > ACCURACY_GAP) flags.push(`Correction rates differ by more than ${ACCURACY_GAP * 100} points across ${cat} groups (possible accuracy difference)`);
        groups.push({ category: cat, rows: gRows.map((r) => (r.suppressed ? { ...r, n: 0 } : r)), flags });
      }
      const allFlags = groups.flatMap((g) => g.flags);
      if (allFlags.length && !v.flaggedAt) {
        await db.scoringVersion.update({ where: { id: v.id }, data: { flaggedAt: new Date(), flagReason: allFlags.join("; ") } });
        v.flaggedAt = new Date();
        v.flagReason = allFlags.join("; ");
      }
    }

    out.push({
      version: v,
      n: rows.length,
      ok: ok.length,
      insufficient: rows.filter((s) => s.status === "insufficient").length,
      alternative: rows.filter((s) => s.status === "alternative").length,
      byBand,
      buckets,
      items,
      corr,
      monotonic,
      groups,
    });
  }
  return out;
}
