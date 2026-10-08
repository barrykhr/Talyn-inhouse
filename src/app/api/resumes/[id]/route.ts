import { audit } from "@/lib/audit";
import { getAuth } from "@/lib/auth";
import { db } from "@/lib/db";

// Serves an uploaded resume only to members of the organization that owns it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const resume = await db.resume.findFirst({ where: { id, orgId: auth.orgId }, include: { file: true } });
  if (!resume) return new Response("Not found", { status: 404 });

  await audit(auth, "resume.downloaded", { subjectType: "candidate", subjectId: resume.id, candidateId: resume.candidateId });
  const body = resume.file ? resume.file.data : Buffer.from((JSON.parse(resume.pagesJson) as string[]).join("\n\n"), "utf8");
  const ext = resume.mimeType === "application/pdf" ? "pdf" : resume.mimeType.includes("wordprocessingml") ? "docx" : "txt";
  return new Response(new Uint8Array(body), {
    headers: {
      "Content-Type": resume.file ? resume.mimeType : "text/plain; charset=utf-8",
      "Content-Disposition": `${ext === "pdf" ? "inline" : "attachment"}; filename="resume-${resume.id}.${ext}"`,
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "sandbox",
    },
  });
}
