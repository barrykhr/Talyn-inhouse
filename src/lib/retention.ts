import "server-only";
import { db } from "./db";

/**
 * Retention: a candidate is eligible for deletion when its most recent activity (profile edit,
 * pipeline change, note, assessment) is older than the org's retentionDays. Activity is
 * measured from stored timestamps; viewing a profile does not count as activity.
 */
export async function eligibleForRetention(orgId: string, retentionDays: number, limit = 500): Promise<string[]> {
  const cutoff = new Date(Date.now() - retentionDays * 86400000);
  const rows = await db.candidate.findMany({
    where: {
      orgId,
      updatedAt: { lt: cutoff },
      applications: { none: { OR: [{ updatedAt: { gte: cutoff } }, { assessments: { some: { createdAt: { gte: cutoff } } } }] } },
      notes: { none: { createdAt: { gte: cutoff } } },
    },
    select: { id: true },
    take: limit,
  });
  return rows.map((r) => r.id);
}
