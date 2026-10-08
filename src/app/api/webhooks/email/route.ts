import { z } from "zod";
import { db } from "@/lib/db";
import { bearerMatches } from "@/lib/integrations/env";
import { logError, logInfo } from "@/lib/log";
import { applyOutcome } from "@/lib/outreach/outcomes";

/**
 * Provider-confirmed email events. Your mail service (or a small relay) POSTs:
 *   Authorization: Bearer $EMAIL_WEBHOOK_SECRET
 *   { "events": [ { "messageId": "<provider message id>", "type": "delivered" | "bounced" | "replied" | "opted_out" | "complained" } ] }
 * messageId is the id the mail server returned when Talyn sent the message.
 * Unknown message ids are ignored. Events never contain or store message content.
 */
const Body = z.object({
  events: z
    .array(z.object({ messageId: z.string().min(1).max(300), type: z.enum(["delivered", "bounced", "replied", "opted_out", "complained"]), note: z.string().max(300).optional() }))
    .max(500),
});

export async function POST(req: Request) {
  if (!bearerMatches(req, process.env.EMAIL_WEBHOOK_SECRET)) return new Response("Unauthorized", { status: 401 });
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return Response.json({ ok: false, error: "Invalid payload" }, { status: 400 });
  let applied = 0;
  let unknown = 0;
  for (const e of parsed.data.events) {
    const id = e.messageId.replace(/^<|>$/g, "");
    const m = await db.outreachMessage.findFirst({ where: { providerMessageId: id }, select: { id: true, orgId: true, sequenceId: true } });
    if (!m) {
      unknown++;
      continue;
    }
    try {
      await applyOutcome({ orgId: m.orgId, userId: null, userName: "Email provider", providerConfirmed: true }, m.sequenceId, e.type === "complained" ? "opted_out" : e.type, {
        messageId: m.id,
        note: e.type === "complained" ? "Marked as spam by the recipient" : e.note,
      });
      applied++;
    } catch (err) {
      logError("outreach.webhook_failed", err, { messageId: m.id });
    }
  }
  logInfo("outreach.webhook", { applied, unknown });
  return Response.json({ ok: true, applied, unknown });
}
