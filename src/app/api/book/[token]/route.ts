import { db } from "@/lib/db";
import { logError } from "@/lib/log";
import { bookingFor } from "@/server/booking-link";
import { bookInterview } from "@/server/scheduling-book";

/**
 * A candidate books one of the proposed times. It's booked exactly as if the person who proposed
 * the times had clicked Schedule (same conflict re-check, same calendar), and recorded as the
 * candidate's pick. The link stops working once used.
 */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const back = (q: string) => Response.redirect(new URL(`/book/${encodeURIComponent(token)}${q}`, req.url), 303);
  const form = await req.formData().catch(() => null);
  const start = Number(form?.get("start"));
  const b = await bookingFor(token);
  if (!b || b.expired || b.booked || !b.s.proposedById) return back("");
  if (!b.slots.includes(start)) return back("?error=invalid");
  const orgId = b.s.stage.kit.application.role.org.id;
  const [user, membership] = await Promise.all([
    db.user.findUnique({ where: { id: b.s.proposedById }, select: { id: true, name: true, email: true } }),
    db.membership.findFirst({ where: { userId: b.s.proposedById, orgId }, select: { role: true } }),
  ]);
  if (!user || !membership) return back("?error=failed");
  const actor = { userId: user.id, userName: `${user.name} (picked by the candidate)`, email: user.email, orgId, orgName: b.s.stage.kit.application.role.org.name, membershipRole: membership.role };
  try {
    const r = await bookInterview(actor, b.s.stageId, { start, requestKey: `cand-${b.s.id}-${start}`, acceptUnknown: true });
    if (r?.error) return back(/conflict|taken/i.test(r.error) ? "?error=taken" : "?error=failed");
  } catch (err) {
    logError("booking.self_book_failed", err);
    return back("?error=failed");
  }
  // Expire the link (it now only shows the booking); a scheduled event also blocks any second booking.
  await db.interviewScheduling.update({ where: { id: b.s.id }, data: { bookingExpiresAt: new Date() } });
  return back("?done=1");
}
