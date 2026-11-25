import { bearerMatches } from "@/lib/integrations/env";
import { autoSearchEnabled, autoSearchOpenRoles } from "@/server/auto-search";
import { refreshSearchIndex } from "@/server/semantic";

// Daily Discover re-search for open roles: adds only people not found before. Nothing is contacted or decided.
export const maxDuration = 300;

export async function GET(req: Request) {
  if (!bearerMatches(req, process.env.CRON_SECRET)) return new Response("Unauthorized", { status: 401 });
  if (!autoSearchEnabled()) return Response.json({ ok: true, skipped: "DISCOVER_AUTO is off." });
  const results = await autoSearchOpenRoles();
  const index = await refreshSearchIndex();
  return Response.json({ ok: true, searched: results.filter((r) => r.status === "searched").length, added: results.reduce((n, r) => n + (r.added ?? 0), 0), results, index });
}
