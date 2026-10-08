import "server-only";
import type { AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { PARSER_VERSION, normalize, parseDocument, type ParsedDocument } from "@/lib/documents";
import { extractCv } from "@/lib/extraction";
import { str } from "./form";
import { storeFacts } from "./facts";

export type PreparedResume = { fileName: string; mimeType: string; sizeBytes: number; data: Buffer | null; parsed: ParsedDocument };

/** Reads the uploaded file or pasted text from a form. Throws DocumentParseError with a recruiter-facing reason. */
export async function prepareResume(fd: FormData, fileField = "resume"): Promise<PreparedResume | null> {
  const file = fd.get(fileField);
  if (file instanceof File && file.size > 0) {
    const data = Buffer.from(await file.arrayBuffer());
    const parsed = await parseDocument(file.name, data);
    return { fileName: file.name.slice(0, 200), mimeType: parsed.mimeType, sizeBytes: data.length, data, parsed };
  }
  const pasted = str(fd, "resumeText", 100000);
  if (pasted)
    return {
      fileName: "Pasted resume text",
      mimeType: "text/plain",
      sizeBytes: pasted.length,
      data: null,
      parsed: { pages: [normalize(pasted)], mimeType: "text/plain", ext: "txt", parserVersion: PARSER_VERSION },
    };
  return null;
}

export async function saveResume(auth: AuthContext, candidateId: string, r: PreparedResume) {
  await db.resume.updateMany({ where: { candidateId, orgId: auth.orgId }, data: { isCurrent: false } });
  return db.resume.create({
    data: {
      orgId: auth.orgId,
      candidateId,
      fileName: r.fileName,
      mimeType: r.mimeType,
      sizeBytes: r.sizeBytes,
      hasFile: r.data !== null,
      parserVersion: r.parsed.parserVersion,
      pagesJson: JSON.stringify(r.parsed.pages),
      isCurrent: true,
      ...(r.data ? { file: { create: { orgId: auth.orgId, data: new Uint8Array(r.data) } } } : {}),
    },
  });
}

/** Extracts profile facts from a stored resume into a pending review. Returns a notice if AI wasn't used. */
export async function extractIntoReview(auth: AuthContext, candidateId: string, resumeId: string, pages: string[]) {
  const outcome = await extractCv(pages);
  await storeFacts(auth.orgId, { type: "candidate", candidateId }, resumeId, outcome.facts);
  await db.candidate.update({ where: { id: candidateId }, data: { extractionStatus: "needs_review" } });
  return outcome.notice;
}

export type FieldOrigins = Record<string, "cv" | "cv_corrected" | "recruiter">;
export function parseOrigins(json: string | null | undefined): FieldOrigins {
  try {
    return JSON.parse(json || "{}") as FieldOrigins;
  } catch {
    return {};
  }
}
