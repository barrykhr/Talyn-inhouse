"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { audit } from "@/lib/audit";
import { requireAuth } from "@/lib/auth";
import { db } from "@/lib/db";
import { normalize } from "@/lib/documents";
import { ownRole } from "./scope";

const Row = z.object({
  fullName: z.string().max(160).optional(),
  firstName: z.string().max(80).optional(),
  lastName: z.string().max(80).optional(),
  email: z.string().max(200).optional(),
  phone: z.string().max(60).optional(),
  location: z.string().max(160).optional(),
  currentTitle: z.string().max(160).optional(),
  currentCompany: z.string().max(160).optional(),
  linkedinUrl: z.string().max(300).optional(),
  candidateSummary: z.string().max(20000).optional(),
  resumeText: z.string().max(100000).optional(),
  note: z.string().max(10000).optional(),
});
type ImportRow = z.infer<typeof Row>;

export type ImportResult = {
  created: number;
  skipped: { row: number; reason: string }[];
  attached: number;
  error?: string;
};

const MAX_ROWS = 200; // per request; the importer sends larger files in batches

/** `offset` is the index of rows[0] in the whole file, so skipped-row numbers match the CSV. */
export async function importCandidates(rows: ImportRow[], roleId: string | null, offset = 0): Promise<ImportResult> {
  const auth = await requireAuth();
  if (!Array.isArray(rows) || rows.length === 0) return { created: 0, attached: 0, skipped: [], error: "No rows to import." };
  if (rows.length > MAX_ROWS) return { created: 0, attached: 0, skipped: [], error: `Import at most ${MAX_ROWS} rows at a time.` };
  if (roleId) await ownRole(auth, roleId);

  const existing = new Set(
    (await db.candidate.findMany({ where: { orgId: auth.orgId, email: { not: null } }, select: { email: true } })).map((c) => c.email!),
  );
  const result: ImportResult = { created: 0, attached: 0, skipped: [] };

  for (let i = 0; i < rows.length; i++) {
    const parsed = Row.safeParse(rows[i]);
    if (!parsed.success) {
      result.skipped.push({ row: offset + i + 2, reason: "A value is too long or malformed" });
      continue;
    }
    const r = trimAll(parsed.data);
    const fullName = r.fullName || [r.firstName, r.lastName].filter(Boolean).join(" ");
    if (!fullName) {
      result.skipped.push({ row: offset + i + 2, reason: "Missing name" });
      continue;
    }
    const email = r.email?.toLowerCase() || null;
    if (email && !z.string().email().safeParse(email).success) {
      result.skipped.push({ row: offset + i + 2, reason: "Invalid email" });
      continue;
    }
    if (email && existing.has(email)) {
      result.skipped.push({ row: offset + i + 2, reason: "A candidate with this email already exists" });
      continue;
    }
    const linkedinUrl = r.linkedinUrl && /^https?:\/\//i.test(r.linkedinUrl) ? r.linkedinUrl : null;

    await db.$transaction(async (tx) => {
      const c = await tx.candidate.create({
        data: {
          orgId: auth.orgId,
          fullName,
          email,
          phone: r.phone || null,
          location: r.location || null,
          currentTitle: r.currentTitle || null,
          currentCompany: r.currentCompany || null,
          linkedinUrl,
          candidateSummary: r.candidateSummary || null,
          source: "csv",
        },
      });
      if (r.resumeText)
        await tx.resume.create({
          data: { orgId: auth.orgId, candidateId: c.id, fileName: "Resume text (CSV import)", mimeType: "text/plain", sizeBytes: r.resumeText.length, pagesJson: JSON.stringify([normalize(r.resumeText)]) },
        });
      if (r.note) await tx.note.create({ data: { orgId: auth.orgId, candidateId: c.id, authorId: auth.userId, authorName: auth.userName, body: r.note } });
      if (roleId) {
        const app = await tx.application.create({ data: { orgId: auth.orgId, candidateId: c.id, roleId, stage: "new" } });
        await tx.stageEvent.create({ data: { orgId: auth.orgId, applicationId: app.id, toStage: "new", actorId: auth.userId, actorName: auth.userName } });
        result.attached++;
      }
    });
    if (email) existing.add(email);
    result.created++;
  }
  await audit(auth, "import.csv", { subjectType: "org", roleId, meta: { created: result.created, skipped: result.skipped.length } });
  revalidatePath("/candidates");
  if (roleId) revalidatePath(`/roles/${roleId}`);
  return result;
}

function trimAll(r: ImportRow): ImportRow {
  return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, typeof v === "string" ? v.trim() : v])) as ImportRow;
}
