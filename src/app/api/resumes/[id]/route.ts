import { getAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import { readStoredFile } from "@/lib/storage";

// Serves an uploaded resume only to members of the organization that owns it.
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const auth = await getAuth();
  if (!auth) return new Response("Unauthorized", { status: 401 });
  const { id } = await params;
  const resume = await db.resume.findFirst({ where: { id, orgId: auth.orgId } });
  if (!resume) return new Response("Not found", { status: 404 });

  try {
    const body = resume.storageKey
      ? await readStoredFile(resume.storageKey)
      : Buffer.from((JSON.parse(resume.pagesJson) as string[]).join("\n\n"), "utf8");
    const ext = resume.mimeType === "application/pdf" ? "pdf" : resume.mimeType.includes("wordprocessingml") ? "docx" : "txt";
    return new Response(new Uint8Array(body), {
      headers: {
        "Content-Type": resume.storageKey ? resume.mimeType : "text/plain; charset=utf-8",
        "Content-Disposition": `${ext === "pdf" ? "inline" : "attachment"}; filename="resume-${resume.id}.${ext}"`,
        "Cache-Control": "private, no-store",
        "X-Content-Type-Options": "nosniff",
        "Content-Security-Policy": "sandbox",
      },
    });
  } catch (err) {
    logError("resume.read_failed", err, { resumeId: id });
    return new Response("File unavailable", { status: 404 });
  }
}
