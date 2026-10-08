import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { db } from "@/lib/db";

// Serves an uploaded job description only to members of the organization that owns it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const jd = await db.jobDescription.findFirst({ where: { id, orgId: auth.orgId }, include: { file: true } });
  if (!jd?.file) return new Response("Not found", { status: 404 });
  await audit(auth, "jd.downloaded", { subjectType: "role", subjectId: jd.id, roleId: jd.roleId });
  const ext = jd.mimeType === "application/pdf" ? "pdf" : "docx";
  return new Response(new Uint8Array(jd.file.data), {
    headers: {
      "Content-Type": jd.mimeType,
      "Content-Disposition": `${ext === "pdf" ? "inline" : "attachment"}; filename="job-description-${jd.id}.${ext}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
