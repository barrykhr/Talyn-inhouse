import "server-only";
import { checkEnv } from "../integrations/env";
import { APOLLO_ENV } from "./apollo";
import { CORESIGNAL_ENV } from "./coresignal";
import { linkedinFrom } from "./http";
import { PDL_ENV } from "./pdl";

/**
 * Contact lookups for one person, run only when a recruiter asks. Each uses the provider's credits.
 * Values come from the provider as returned: nothing is guessed or built from a name and domain.
 */

export type ContactResult = {
  found: boolean;
  email: string | null;
  emailNote: string | null; // e.g. "work email · verified"
  phone: string | null;
  fullName: string | null;
  linkedinUrl: string | null;
  location: string | null;
  note: string | null; // why nothing was found, or a limitation
};

export const CONTACT_PROVIDERS: Record<string, { label: string; configured: () => boolean; cost: string }> = {
  coresignal: { label: "Coresignal", configured: () => checkEnv(CORESIGNAL_ENV).ready, cost: "Coresignal Contact Enrichment credits (work email)" },
  pdl: { label: "People Data Labs", configured: () => checkEnv(PDL_ENV).ready, cost: "1 People Data Labs credit (emails and phone, on paid plans)" },
  apollo: { label: "Apollo.io", configured: () => checkEnv(APOLLO_ENV).ready, cost: "1 Apollo credit for an email (phones need Apollo's webhook flow and aren't requested)" },
};

const isEmail = (v: unknown): v is string => typeof v === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
const isPhone = (v: unknown): v is string => typeof v === "string" && v.replace(/\D/g, "").length >= 8;
const empty = (note: string): ContactResult => ({ found: false, email: null, emailNote: null, phone: null, fullName: null, linkedinUrl: null, location: null, note });

async function call(url: string, init: RequestInit, label: string): Promise<{ status: number; body: unknown }> {
  try {
    const res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000), cache: "no-store" });
    const body = await res.json().catch(() => null);
    return { status: res.status, body };
  } catch {
    throw new Error(`${label} couldn't be reached. Try again in a moment.`);
  }
}

function httpProblem(label: string, status: number): string | null {
  if (status === 401 || status === 403) return `${label} rejected the API key, or the plan doesn't include contact data.`;
  if (status === 402) return `${label} is out of credits.`;
  if (status === 429) return `${label}'s rate limit was reached. Try again in a minute.`;
  if (status >= 500) return `${label} returned an error (HTTP ${status}).`;
  return null;
}

/** recordId is the provider's own id (without the "provider:" prefix). */
export async function lookupContact(provider: string, recordId: string): Promise<ContactResult> {
  if (provider === "coresignal") {
    const { status, body } = await call(`https://api.coresignal.com/enrichment/contacts?member_id=${encodeURIComponent(recordId)}`, { headers: { apikey: process.env.CORESIGNAL_API_KEY ?? "", accept: "application/json" } }, "Coresignal");
    const problem = httpProblem("Coresignal", status);
    if (problem) throw new Error(problem);
    const d = (body as { code?: number; data?: { email?: string; email_status?: string; email_confidence?: number } | null } | null)?.data;
    if (!d || !isEmail(d.email)) return empty("Coresignal has no work email for this person.");
    return { found: true, email: d.email, emailNote: ["work email", d.email_status, d.email_confidence != null ? `confidence ${d.email_confidence}` : null].filter(Boolean).join(" · "), phone: null, fullName: null, linkedinUrl: null, location: null, note: null };
  }
  if (provider === "pdl") {
    const { status, body } = await call(`https://api.peopledatalabs.com/v5/person/retrieve/${encodeURIComponent(recordId)}`, { headers: { "x-api-key": process.env.PDL_API_KEY ?? "", accept: "application/json" } }, "People Data Labs");
    if (status === 404) return empty("People Data Labs no longer has this record.");
    const problem = httpProblem("People Data Labs", status);
    if (problem) throw new Error(problem);
    const d = (body as { data?: Record<string, unknown> } | null)?.data ?? {};
    const personal = Array.isArray(d.personal_emails) ? d.personal_emails.find(isEmail) : null;
    const email = [d.work_email, d.recommended_personal_email, personal].find(isEmail) ?? null;
    const phones = Array.isArray(d.phone_numbers) ? d.phone_numbers : [];
    const phone = [d.mobile_phone, ...phones].find(isPhone) ?? null;
    if (!email && !phone) {
      const hidden = d.work_email === true || d.mobile_phone === true || d.personal_emails === true;
      return empty(hidden ? "People Data Labs has contact data for this person, but your plan doesn't include it." : "People Data Labs has no email or phone for this person.");
    }
    return { found: true, email, emailNote: email ? (email === d.work_email ? "work email" : "personal email") : null, phone, fullName: null, linkedinUrl: null, location: null, note: null };
  }
  if (provider === "apollo") {
    const qs = new URLSearchParams({ id: recordId, reveal_personal_emails: "true", reveal_phone_number: "false" });
    const { status, body } = await call(`https://api.apollo.io/api/v1/people/match?${qs}`, { method: "POST", headers: { "x-api-key": process.env.APOLLO_API_KEY ?? "", "content-type": "application/json", accept: "application/json", "cache-control": "no-cache" } }, "Apollo.io");
    const problem = httpProblem("Apollo", status);
    if (problem) throw new Error(problem);
    const p = (body as { person?: Record<string, unknown> | null } | null)?.person;
    if (!p) return empty("Apollo couldn't match this person.");
    const personal = Array.isArray(p.personal_emails) ? p.personal_emails.find(isEmail) : null;
    const email = [p.email, personal].find(isEmail) ?? null;
    const loc = [p.city, p.state, p.country].filter((x): x is string => typeof x === "string" && !!x).join(", ") || null;
    return {
      found: !!email,
      email,
      emailNote: email ? [email === p.email ? "work email" : "personal email", typeof p.email_status === "string" ? p.email_status : null].filter(Boolean).join(" · ") : null,
      phone: null,
      fullName: typeof p.name === "string" && p.name.trim() ? p.name.trim() : null,
      linkedinUrl: typeof p.linkedin_url === "string" ? linkedinFrom(p.linkedin_url) : null,
      location: loc,
      note: email ? null : "Apollo has no email for this person.",
    };
  }
  return empty("This source doesn't offer contact lookups.");
}
