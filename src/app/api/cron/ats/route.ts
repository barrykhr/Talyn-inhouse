import { getAtsConnector } from "@/lib/ats/connector";
import { linkedOrg, processOutbox, pullFromAts } from "@/lib/ats/sync";
import { bearerMatches } from "@/lib/integrations/env";

// Scheduled ATS sync for the linked workspace. No-op until an ATS is configured and linked.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!bearerMatches(req, process.env.CRON_SECRET)) return new Response("Unauthorized", { status: 401 });
  if (!getAtsConnector()) return Response.json({ ok: true, skipped: "No ATS configured." });
  const org = await linkedOrg();
  if (!org) return Response.json({ ok: true, skipped: "No workspace linked to the ATS." });
  const push = await processOutbox(org.id);
  const pull = await pullFromAts(org.id, "Scheduled sync");
  return Response.json({ ok: true, pull, push });
}
