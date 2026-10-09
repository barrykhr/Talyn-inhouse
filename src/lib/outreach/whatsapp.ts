import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { checkEnv } from "../integrations/env";

/**
 * WhatsApp sending through the WhatsApp Business Platform (Cloud API). Off until configured.
 *
 * Business-initiated WhatsApp messages must use a template approved in your WhatsApp Business
 * account, so Talyn sends the configured template and fills its body parameters from
 * WHATSAPP_TEMPLATE_PARAMS (e.g. "first_name,role_title,company,recruiter_name"). Only if your
 * approved template has a free-text parameter mapped to `message` is the drafted text sent in it.
 * Talyn also requires a recorded WhatsApp opt-in for the candidate before anything is sent.
 */
export const WHATSAPP_ENV = [
  { name: "WHATSAPP_ACCESS_TOKEN", purpose: "Permanent access token for your WhatsApp Business app", secret: true },
  { name: "WHATSAPP_PHONE_NUMBER_ID", purpose: "Phone number ID of the sending business number" },
  { name: "WHATSAPP_TEMPLATE_NAME", purpose: "Name of the approved message template to send" },
  { name: "WHATSAPP_TEMPLATE_LANGUAGE", purpose: "Template language code (default en)", optional: true },
  { name: "WHATSAPP_TEMPLATE_PARAMS", purpose: "Body parameters in order: first_name, role_title, company, recruiter_name, message", optional: true },
  { name: "WHATSAPP_TEMPLATE_PREVIEW", purpose: "The approved template text with {{1}}, {{2}}… — shown to recruiters as a preview", optional: true },
  { name: "WHATSAPP_APP_SECRET", purpose: "App secret, to verify webhook signatures (replies and delivery status)", secret: true, optional: true },
  { name: "WHATSAPP_VERIFY_TOKEN", purpose: "Token you choose for webhook verification", secret: true, optional: true },
];

export const TEMPLATE_PARAM_KEYS = ["first_name", "role_title", "company", "recruiter_name", "message"] as const;
export type TemplateVars = Partial<Record<(typeof TEMPLATE_PARAM_KEYS)[number], string>>;

export function whatsappSetup() {
  return checkEnv(WHATSAPP_ENV);
}

export function whatsappTemplate() {
  const params = (process.env.WHATSAPP_TEMPLATE_PARAMS || "first_name,role_title,company,recruiter_name")
    .split(",")
    .map((s) => s.trim())
    .filter((s): s is (typeof TEMPLATE_PARAM_KEYS)[number] => (TEMPLATE_PARAM_KEYS as readonly string[]).includes(s));
  return { name: process.env.WHATSAPP_TEMPLATE_NAME ?? "", language: process.env.WHATSAPP_TEMPLATE_LANGUAGE || "en", params, preview: process.env.WHATSAPP_TEMPLATE_PREVIEW ?? null };
}

/** What the candidate will receive: the approved template with its parameters filled in. */
export function renderTemplatePreview(vars: TemplateVars): string | null {
  const t = whatsappTemplate();
  if (!t.preview) return null;
  return t.preview.replace(/\{\{\s*(\d+)\s*\}\}/g, (m, n: string) => vars[t.params[Number(n) - 1]] ?? m);
}

/** E.164 digits for the Cloud API, or null when the number has no country code. */
export function waNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const t = phone.trim();
  if (!t.startsWith("+") && !t.startsWith("00")) return null;
  const digits = t.replace(/^00/, "").replace(/\D/g, "");
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}

export function whatsappConfigured() {
  return whatsappSetup().ready;
}

export async function sendWhatsAppTemplate(to: string, vars: TemplateVars): Promise<{ providerMessageId: string }> {
  const t = whatsappTemplate();
  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID!)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to,
      type: "template",
      template: {
        name: t.name,
        language: { code: t.language },
        ...(t.params.length ? { components: [{ type: "body", parameters: t.params.map((k) => ({ type: "text", text: (vars[k] ?? "").slice(0, 1000) || "-" })) }] } : {}),
      },
    }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`WhatsApp API responded ${res.status}`);
  const body = (await res.json()) as { messages?: { id: string }[] };
  return { providerMessageId: body.messages?.[0]?.id ?? "" };
}

/** Verifies Meta's X-Hub-Signature-256 header over the raw request body. */
export function verifyWhatsAppSignature(raw: string, header: string | null): boolean {
  const secret = process.env.WHATSAPP_APP_SECRET;
  if (!secret || !header?.startsWith("sha256=")) return false;
  const want = Buffer.from(createHmac("sha256", secret).update(raw).digest("hex"));
  const got = Buffer.from(header.slice(7));
  return got.length === want.length && timingSafeEqual(got, want);
}

export const WHATSAPP_SETUP_HINT =
  "WhatsApp isn't connected, so Talyn can't send on it. To enable it, connect the WhatsApp Business Platform (Cloud API) with an approved message template (Settings → Integrations). Drafts can still be prepared.";

/** Whether the approved template carries a free-text `message` parameter (so drafted text can be sent in it). */
export function templateCarriesMessage() {
  return whatsappTemplate().params.includes("message");
}

/**
 * A free-form text message. WhatsApp only allows this within 24 hours of the candidate's last
 * message to you (the customer-service window); callers must check that first.
 */
export async function sendWhatsAppText(to: string, text: string): Promise<{ providerMessageId: string }> {
  const res = await fetch(`https://graph.facebook.com/v21.0/${encodeURIComponent(process.env.WHATSAPP_PHONE_NUMBER_ID!)}/messages`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${process.env.WHATSAPP_ACCESS_TOKEN}` },
    body: JSON.stringify({ messaging_product: "whatsapp", to, type: "text", text: { body: text.slice(0, 4000) } }),
    signal: AbortSignal.timeout(30_000),
    cache: "no-store",
  });
  if (!res.ok) throw new Error(`WhatsApp API responded ${res.status}`);
  const body = (await res.json()) as { messages?: { id: string }[] };
  return { providerMessageId: body.messages?.[0]?.id ?? "" };
}
