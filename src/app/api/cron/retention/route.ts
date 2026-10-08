import { db } from "@/lib/db";
import { logInfo } from "@/lib/log";
import { eligibleForRetention } from "@/lib/retention";

// Daily retention job (see vercel.json). Requires CRON_SECRET; Vercel Cron sends it as a bearer token.
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.get("authorization") !== `Bearer ${secret}`) return new Response("Unauthorized", { status: 401 });
  const orgs = await db.organization.findMany({ where: { retentionDays: { not: null } }, select: { id: true, retentionDays: true } });
  let total = 0;
  for (const org of orgs) {
    const ids = await eligibleForRetention(org.id, org.retentionDays!);
    if (!ids.length) continue;
    await db.candidate.deleteMany({ where: { orgId: org.id, id: { in: ids } } });
    await db.sourcedProfile.deleteMany({ where: { orgId: org.id, source: "talyn", sourceRecordId: { in: ids } } });
    await db.auditEvent.create({
      data: { orgId: org.id, actorName: "Retention job", action: "retention.applied", subjectType: "org", subjectId: org.id, metaJson: JSON.stringify({ deleted: ids.length, days: org.retentionDays }) },
    });
    total += ids.length;
  }
  logInfo("cron.retention", { orgs: orgs.length, deleted: total });
  return Response.json({ ok: true, deleted: total });
}
