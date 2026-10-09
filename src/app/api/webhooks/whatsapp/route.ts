import { db } from "@/lib/db";
import { logError, logInfo } from "@/lib/log";
import { applyOutcome } from "@/lib/outreach/outcomes";
import { verifyWhatsAppSignature, whatsappConfigured } from "@/lib/outreach/whatsapp";

// WhatsApp Business Platform webhook. GET = Meta's verification handshake. POST = message status
// and inbound replies, signed with the app secret. Replies stop follow-ups; delivery is recorded
// as provider-confirmed. Message text is never stored.

export async function GET(req: Request) {
  const u = new URL(req.url);
  const token = process.env.WHATSAPP_VERIFY_TOKEN;
  if (token && u.searchParams.get("hub.mode") === "subscribe" && u.searchParams.get("hub.verify_token") === token) return new Response(u.searchParams.get("hub.challenge") ?? "", { status: 200 });
  return new Response("Forbidden", { status: 403 });
}

type Change = {
  value?: {
    statuses?: { id: string; status: string; recipient_id?: string }[];
    messages?: { from: string; type: string; context?: { id?: string } }[];
  };
};

export async function POST(req: Request) {
  const raw = await req.text();
  if (!whatsappConfigured() || !verifyWhatsAppSignature(raw, req.headers.get("x-hub-signature-256"))) return new Response("Unauthorized", { status: 401 });
  let body: { entry?: { changes?: Change[] }[] };
  try {
    body = JSON.parse(raw);
  } catch {
    return new Response("Bad request", { status: 400 });
  }
  let applied = 0;
  for (const change of (body.entry ?? []).flatMap((e) => e.changes ?? [])) {
    for (const st of change.value?.statuses ?? []) {
      if (st.status !== "delivered" && st.status !== "failed") continue;
      const m = await db.outreachMessage.findFirst({ where: { providerMessageId: st.id, sentVia: "whatsapp" }, select: { id: true, orgId: true, sequenceId: true } });
      if (!m) continue;
      try {
        if (st.status === "delivered") await applyOutcome({ orgId: m.orgId, userId: null, userName: "WhatsApp", providerConfirmed: true }, m.sequenceId, "delivered", { messageId: m.id });
        else await db.outreachEvent.create({ data: { orgId: m.orgId, sequenceId: m.sequenceId, messageId: m.id, type: "send_failed", providerConfirmed: true, actorName: "WhatsApp", note: "WhatsApp reported the message as failed" } });
        applied++;
      } catch (err) {
        logError("whatsapp.status_failed", err, { messageId: m.id });
      }
    }
    for (const msg of change.value?.messages ?? []) {
      // A reply to an assistant follow-up (information request): mark it replied. Text isn't stored.
      const task =
        (msg.context?.id ? await db.task.findFirst({ where: { agentProviderId: msg.context.id, agentStatus: "sent" }, select: { id: true } }) : null) ??
        (await db.task.findFirst({ where: { agentChannel: "whatsapp", agentTo: msg.from, agentStatus: "sent" }, orderBy: { agentSentAt: "desc" }, select: { id: true } }));
      if (task) {
        await db.task.update({ where: { id: task.id }, data: { agentStatus: "replied", agentReplyAt: new Date(), agentReplyVia: "WhatsApp" } });
        applied++;
        continue;
      }
      // A reply: match the message it answers, else the latest WhatsApp message sent to this number.
      const m =
        (msg.context?.id ? await db.outreachMessage.findFirst({ where: { providerMessageId: msg.context.id }, select: { id: true, orgId: true, sequenceId: true } }) : null) ??
        (await db.outreachMessage.findFirst({ where: { sentVia: "whatsapp", toPhone: msg.from }, orderBy: { sentAt: "desc" }, select: { id: true, orgId: true, sequenceId: true } }));
      if (!m) continue;
      try {
        await applyOutcome({ orgId: m.orgId, userId: null, userName: "WhatsApp", providerConfirmed: true }, m.sequenceId, "replied", { messageId: m.id, note: "Candidate replied on WhatsApp" });
        applied++;
      } catch (err) {
        logError("whatsapp.reply_failed", err, { messageId: m.id });
      }
    }
  }
  logInfo("whatsapp.webhook", { applied });
  return Response.json({ ok: true });
}
