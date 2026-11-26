import "server-only";
import { db } from "@/lib/db";

/** Open roles and their active candidates, for choosing where a call belongs. */
export async function callSetupOptions(orgId: string) {
  const roles = await db.role.findMany({ where: { orgId, status: { not: "closed" } }, orderBy: { updatedAt: "desc" }, select: { id: true, title: true }, take: 100 });
  const apps = await db.application.findMany({
    where: { orgId, roleId: { in: roles.map((r) => r.id) }, stage: { notIn: ["rejected", "hired"] } },
    select: { id: true, roleId: true, candidate: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
    take: 3000,
  });
  const byRole: Record<string, { id: string; name: string }[]> = {};
  for (const a of apps) (byRole[a.roleId] ??= []).push({ id: a.id, name: a.candidate.fullName });
  return { roles, byRole };
}
