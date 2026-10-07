import { getAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { STAGE_LABEL, type Stage } from "@/lib/domain";
import { csvResponse, today } from "@/lib/export";

export async function GET() {
  const auth = await getAuth();
  if (!auth) return new Response("Unauthorized", { status: 401 });
  const candidates = await db.candidate.findMany({
    where: { orgId: auth.orgId },
    include: { applications: { include: { role: { select: { title: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  const rows = candidates.map((c) => [
    c.id,
    c.fullName,
    c.email,
    c.phone,
    c.location,
    c.currentTitle,
    c.currentCompany,
    c.linkedinUrl,
    c.source,
    c.applications.map((a) => `${a.role.title} (${STAGE_LABEL[a.stage as Stage] ?? a.stage})`).join("; "),
    c.createdAt,
  ]);
  return csvResponse(`talyn-candidates-${today()}.csv`, ["id", "full_name", "email", "phone", "location", "current_title", "current_company", "linkedin_url", "source", "roles_and_stages", "created_at"], rows);
}
