import { bearerMatches } from "@/lib/integrations/env";
import { sendDueMessages } from "@/lib/outreach/send";

// Sends due, recruiter-approved messages in ACTIVE sequences via the configured email provider.
// With no provider configured it does nothing. Protected by CRON_SECRET.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!bearerMatches(req, process.env.CRON_SECRET)) return new Response("Unauthorized", { status: 401 });
  const r = await sendDueMessages({ triggeredBy: "Scheduled send" });
  if (!r) return Response.json({ ok: true, skipped: "No email provider configured; messages are sent manually by recruiters." });
  return Response.json({ ok: true, ...r });
}
