import { getAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { csvResponse, today } from "@/lib/export";

/** One row per role per approved criterion (roles without criteria get one row). */
export async function GET() {
  const auth = await getAuth();
  if (!auth) return new Response("Unauthorized", { status: 401 });
  const roles = await db.role.findMany({
    where: { orgId: auth.orgId },
    include: { criteria: { where: { status: "approved" }, orderBy: { position: "asc" } }, _count: { select: { applications: true } } },
    orderBy: { createdAt: "asc" },
  });
  const rows: unknown[][] = [];
  for (const r of roles) {
    const base = [r.id, r.title, r.department, r.location, r.employmentType, r.status, r._count.applications];
    if (r.criteria.length === 0) rows.push([...base, "", "", "", ""]);
    for (const c of r.criteria) rows.push([...base, c.name, c.importance, c.priority ?? "", c.description]);
  }
  return csvResponse(`talyn-roles-${today()}.csv`, ["role_id", "title", "department", "location", "employment_type", "status", "candidates", "criterion", "importance", "priority", "criterion_description"], rows);
}
