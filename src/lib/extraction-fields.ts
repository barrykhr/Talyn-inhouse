// Field definitions for reviewing extracted JD/CV details. Shared by server pages and
// client forms, so it must not live in a "use client" module.

export const LIST_LABEL: Record<string, string> = {
  responsibility: "Responsibilities",
  qualification: "Qualifications",
  experience_requirement: "Experience requirements",
};

export const CV_SCALARS = [
  { field: "full_name", label: "Full name", column: "fullName" },
  { field: "email", label: "Email", column: "email" },
  { field: "phone", label: "Phone", column: "phone" },
  { field: "location", label: "Location", column: "location" },
  { field: "linkedin_url", label: "LinkedIn URL", column: "linkedinUrl" },
  { field: "current_title", label: "Current title", column: "currentTitle" },
  { field: "current_company", label: "Current company", column: "currentCompany" },
] as const;

export const CV_LISTS: { field: string; label: string; keys: { key: string; label: string }[] }[] = [
  { field: "work_history", label: "Work history", keys: [{ key: "title", label: "Title" }, { key: "employer", label: "Employer" }, { key: "start", label: "Start" }, { key: "end", label: "End" }] },
  { field: "education", label: "Education", keys: [{ key: "institution", label: "Institution" }, { key: "credential", label: "Credential" }, { key: "field", label: "Field" }] },
  { field: "certification", label: "Certifications", keys: [{ key: "name", label: "Name" }, { key: "issuer", label: "Issuer" }] },
  { field: "skill", label: "Skills", keys: [] },
];

