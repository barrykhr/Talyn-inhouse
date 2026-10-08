import "server-only";
import { db } from "../db";
import { ORIGIN_LABEL } from "../domain";

export type PersonalizationFact = { key: string; label: string; value: string; source: string };

/**
 * Facts that may be used to personalize outreach: recruiter-confirmed, corrected or entered
 * profile fields and reviewed CV facts. Contact details and unreviewed extractions are excluded.
 */
export async function personalizationFacts(orgId: string, candidateId: string): Promise<PersonalizationFact[]> {
  const c = await db.candidate.findFirstOrThrow({
    where: { id: candidateId, orgId },
    include: { extracted: { where: { status: { in: ["accepted", "edited"] } }, orderBy: { position: "asc" } } },
  });
  const origins = JSON.parse(c.fieldOriginsJson || "{}") as Record<string, string>;
  const out: PersonalizationFact[] = [];
  const add = (key: string, label: string, value: string | null | undefined, source: string) => {
    if (value && value.trim()) out.push({ key, label, value: value.trim().slice(0, 300), source });
  };
  const originLabel = (col: string) => ORIGIN_LABEL[origins[col] ?? (c.source === "csv" ? "csv" : "recruiter")] ?? "Talyn profile";
  add("first_name", "First name", c.fullName.startsWith("Unnamed candidate") ? null : c.fullName.split(/\s+/)[0], originLabel("fullName"));
  add("current_title", "Current title", c.currentTitle, originLabel("currentTitle"));
  add("current_company", "Current company", c.currentCompany, originLabel("currentCompany"));
  add("location", "Location", c.location, originLabel("location"));
  let n = 0;
  for (const f of c.extracted) {
    if (n >= 12) break;
    const v = JSON.parse(f.status === "edited" && f.editedValueJson ? f.editedValueJson : f.valueJson) as unknown;
    const src = `CV${f.sourcePage ? ` p.${f.sourcePage}` : ""}${f.sourceSection ? ` · ${f.sourceSection}` : ""} · ${f.status === "edited" ? "corrected" : "confirmed"} by recruiter`;
    if (f.field === "work_history" && v && typeof v === "object") {
      const w = v as Record<string, string>;
      add(`work_${f.id}`, "Experience", [w.title, w.employer].filter(Boolean).join(" at ") + (w.start || w.end ? ` (${[w.start, w.end].filter(Boolean).join("–")})` : ""), src);
      n++;
    } else if (f.field === "skill" && typeof v === "string") {
      add(`skill_${f.id}`, "Skill", v, src);
      n++;
    } else if (f.field === "certification" && v && typeof v === "object") {
      add(`cert_${f.id}`, "Certification", (v as Record<string, string>).name, src);
      n++;
    }
  }
  return out;
}

export const OPT_OUT_FOOTER = "\n\nIf you'd rather not hear from us about roles, just reply and let me know and I won't contact you again.";

/** Fills {{placeholders}} from known facts only; unknown placeholders are left visible for the recruiter to fix. */
export function fillTemplate(text: string, vars: Record<string, string | undefined>) {
  return text.replace(/\{\{\s*(\w+)\s*\}\}/g, (m, k: string) => vars[k] ?? m);
}
