import "server-only";
import { audit } from "@/lib/audit";
import type { AuthContext } from "@/lib/auth";
import { db } from "@/lib/db";
import type { CriterionDraft, FactDraft } from "@/lib/extraction";

/** Replaces a subject's pending (unreviewed) facts with a fresh extraction. Reviewed facts are kept. */
export async function storeFacts(
  orgId: string,
  subject: { type: "role"; roleId: string } | { type: "candidate"; candidateId: string },
  documentId: string,
  facts: FactDraft[],
) {
  const where = subject.type === "role" ? { roleId: subject.roleId } : { candidateId: subject.candidateId };
  await db.extractedField.deleteMany({ where: { orgId, ...where, status: "pending" } });
  if (!facts.length) return;
  await db.extractedField.createMany({
    data: facts.map((f, i) => ({
      orgId,
      subjectType: subject.type,
      ...where,
      documentId,
      field: f.field,
      valueJson: JSON.stringify(f.value),
      sourceQuote: f.sourceQuote?.slice(0, 1000) ?? null,
      sourcePage: f.sourcePage,
      sourceSection: f.sourceSection,
      verified: f.verified,
      extractor: f.extractor,
      status: "pending",
      position: i,
    })),
  });
}

/** Adds drafted criteria as "proposed" (inactive until approved), replacing earlier unreviewed proposals. */
export async function storeProposedCriteria(orgId: string, roleId: string, drafts: CriterionDraft[], origin: "ai" | "extracted") {
  await db.criterion.deleteMany({ where: { roleId, orgId, status: "proposed" } });
  if (!drafts.length) return;
  const last = await db.criterion.findFirst({ where: { roleId }, orderBy: { position: "desc" } });
  let pos = (last?.position ?? 0) + 1;
  await db.criterion.createMany({
    data: drafts.map((d) => ({
      orgId,
      roleId,
      name: d.name,
      description: d.description,
      importance: d.importance,
      origin,
      originalName: d.name,
      originalDescription: d.description,
      sourceText: d.sourceText,
      sourcePage: d.sourcePage,
      sourceSection: d.sourceSection,
      rationale: d.rationale,
      status: "proposed",
      position: pos++,
    })),
  });
}

/** Call whenever the set or wording of APPROVED criteria changes. Audited with the new version. */
export async function bumpCriteriaVersion(roleId: string, auth: AuthContext, change: string) {
  const r = await db.role.update({ where: { id: roleId }, data: { criteriaVersion: { increment: 1 } }, select: { criteriaVersion: true } });
  await audit(auth, "criteria.changed", { subjectType: "role", subjectId: roleId, roleId, meta: { change, version: r.criteriaVersion } });
}

export function parseValue(json: string | null | undefined): unknown {
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}
