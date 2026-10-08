import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import { applyOutcome } from "@/lib/outreach/outcomes";
import { verifyUnsubscribeToken } from "@/lib/outreach/signing";

// Candidate opt-out from an outreach email. Handles the RFC 8058 one-click POST from mail
// clients and the confirmation form on /unsubscribe/[token]. No sign-in; the token is signed.
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const messageId = verifyUnsubscribeToken(token);
  const fromForm = (req.headers.get("content-type") ?? "").includes("application/x-www-form-urlencoded") && !(await req.clone().text()).includes("List-Unsubscribe=One-Click");
  const done = (ok: boolean) => (fromForm ? Response.redirect(new URL(`/unsubscribe/${encodeURIComponent(token)}?${ok ? "done=1" : "invalid=1"}`, req.url), 303) : new Response(ok ? "Unsubscribed" : "Invalid link", { status: ok ? 200 : 400 }));
  if (!messageId) return done(false);
  try {
    const m = await db.outreachMessage.findUnique({ where: { id: messageId }, select: { orgId: true, sequenceId: true, sequence: { select: { application: { select: { candidate: { select: { contactOptOut: true } } } } } } } });
    if (!m) return done(true); // data may have been deleted (retention); nothing left to contact
    if (!m.sequence.application.candidate.contactOptOut)
      await applyOutcome({ orgId: m.orgId, userId: null, userName: "Candidate (unsubscribe link)", providerConfirmed: true }, m.sequenceId, "opted_out", { messageId, note: "Candidate used the unsubscribe link" });
    return done(true);
  } catch (err) {
    logError("outreach.unsubscribe_failed", err);
    return new Response("Something went wrong. Reply to the email and ask not to be contacted.", { status: 500 });
  }
}
