// CSV helpers shared by import and export.

/** Escapes a cell and neutralizes spreadsheet formula injection. */
export function csvCell(value: unknown): string {
  let s = value === null || value === undefined ? "" : value instanceof Date ? value.toISOString() : String(value);
  if (/^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(headers: string[], rows: unknown[][]): string {
  return [headers, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}

export const IMPORT_FIELDS = [
  { key: "fullName", label: "Full name", aliases: ["name", "full name", "candidate", "candidate name"] },
  { key: "firstName", label: "First name", aliases: ["first name", "firstname", "given name"] },
  { key: "lastName", label: "Last name", aliases: ["last name", "lastname", "surname", "family name"] },
  { key: "email", label: "Email", aliases: ["email", "e-mail", "email address"] },
  { key: "phone", label: "Phone", aliases: ["phone", "phone number", "mobile", "telephone"] },
  { key: "location", label: "Location", aliases: ["location", "city", "based in"] },
  { key: "currentTitle", label: "Current title", aliases: ["title", "current title", "job title", "position", "headline"] },
  { key: "currentCompany", label: "Current company", aliases: ["company", "current company", "employer"] },
  { key: "linkedinUrl", label: "LinkedIn URL", aliases: ["linkedin", "linkedin url", "linkedin profile"] },
  { key: "candidateSummary", label: "Candidate-provided info", aliases: ["summary", "cover letter", "application answers", "about"] },
  { key: "resumeText", label: "Resume text", aliases: ["resume", "resume text", "cv", "cv text"] },
  { key: "note", label: "Recruiter note", aliases: ["note", "notes", "recruiter note", "comments"] },
] as const;
export type ImportFieldKey = (typeof IMPORT_FIELDS)[number]["key"];

export function guessMapping(headers: string[]): Record<string, ImportFieldKey | ""> {
  const map: Record<string, ImportFieldKey | ""> = {};
  const used = new Set<string>();
  for (const h of headers) {
    const norm = h.trim().toLowerCase().replace(/[_]+/g, " ");
    const f = IMPORT_FIELDS.find((f) => !used.has(f.key) && (f.aliases as readonly string[]).includes(norm));
    map[h] = f ? f.key : "";
    if (f) used.add(f.key);
  }
  return map;
}
